import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createProxy } from 'proxy';
import { describe, expect, it } from 'vitest';
import { createParser, gzipped, listen, redirect, serve, sitemapIndex, urlset, xml } from './helpers';

const SITEMAP = urlset('https://example.com/');
const PAGES = ['https://example.com/'];

describe('content types', () => {
	it.each([
		'application/xml',
		'text/xml; charset=utf-8',
		'APPLICATION/XML',
		'application/rss+xml',
		'application/atom+xml',
		'text/plain',
	])('accepts %s', async type => {
		const site = await serve({ '/s': { type, body: SITEMAP } });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
	});

	it.each([
		['text/html', 'text/html'],
		['a type that merely contains an allowed one', 'text/xml-but-not-really'],
		['no content type', 'missing'],
	])('rejects %s by default', async (_, type) => {
		const site = await serve({ '/s': { type: type === 'missing' ? undefined : type, body: SITEMAP } });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.urls).toEqual([]);
		expect(result.errors).toEqual([{
			url: `${site.url}/s`,
			reason: expect.stringContaining('invalid "Content-Type" header'),
		}]);
	});

	it.each(['text/html', undefined])('accepts %s when rejectInvalidContentType is off', async type => {
		const site = await serve({ '/s': { type, body: SITEMAP } });
		const result = await createParser({ rejectInvalidContentType: false }).run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
	});

	it('accepts a duplicated Content-Type header when one value is allowed', async () => {
		const site = await serve({ '/s': { type: 'text/html; charset=utf-8, application/xml;charset=utf-8', body: SITEMAP } });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
	});

	it('rejects a duplicated Content-Type header when no value is allowed', async () => {
		const site = await serve({ '/s': { type: 'text/html, image/png', body: SITEMAP } });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.errors[0].reason).toContain('invalid "Content-Type"');
	});

	it('only asks for sitemap content types when strict', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		await createParser().run(`${site.url}/s`);
		await createParser({ rejectInvalidContentType: false }).run(`${site.url}/s`);
		expect(site.requests[0].headers.accept).toContain('application/xml');
		expect(site.requests[1].headers.accept).toBeUndefined();
	});
});

describe('gzip', () => {
	it.each([
		['application/gzip', 'application/gzip'],
		['application/x-gzip', 'application/x-gzip'],
		['application/zip, which some sites use for gzip', 'application/zip'],
		['a generic binary type', 'application/octet-stream'],
		['an XML type', 'application/xml'],
	])('inflates a gzipped sitemap served as %s', async (_, type) => {
		const site = await serve({ '/s.xml.gz': { type, body: gzipSync(SITEMAP) } });
		const result = await createParser().run(`${site.url}/s.xml.gz`);
		expect(result.urls).toEqual(PAGES);
	});

	it('does not accept arbitrary binary data as a generic binary type', async () => {
		const site = await serve({ '/s': { type: 'application/octet-stream', body: Buffer.from(SITEMAP) } });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.errors[0].reason).toContain('invalid "Content-Type"');
	});

	it('reads gzipped sitemaps listed by an index', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml.gz`)),
			'/a.xml.gz': gzipped(SITEMAP),
		});
		expect((await createParser().run(`${site.url}/index.xml`)).urls).toEqual(PAGES);
	});

	it('reports gzip data that is corrupt', async () => {
		const site = await serve({ '/s': { type: 'application/gzip', body: gzipSync(SITEMAP).subarray(0, 20) } });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.errors).toEqual([{ url: `${site.url}/s`, reason: expect.stringContaining('Invalid gzip data') }]);
	});
});

describe('request headers', () => {
	it('sends the default and a custom user agent', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		await createParser().run(`${site.url}/s`);
		await createParser({ userAgent: 'Custom/1.0' }).run(`${site.url}/s`);
		expect(site.requests[0].headers['user-agent']).toMatch(/^Mozilla\/5\.0 .* Chrome\//);
		expect(site.requests[1].headers['user-agent']).toBe('Custom/1.0');
	});

	it.each([
		['user:password', 'user:password'],
		['an encoded password', 'user:p%40ss'],
		['an empty password', 'user:'],
	])('turns URL credentials (%s) into Basic Auth and removes them from the URL', async (_, credentials) => {
		const site = await serve({ '/s': xml(SITEMAP) });
		const url = site.url.replace('http://', `http://${credentials}@`);
		const result = await createParser().run(`${url}/s`);
		expect(result.urls).toEqual(PAGES);
		const expected = Buffer.from(decodeURIComponent(credentials)).toString('base64');
		expect(site.requests[0].headers.authorization).toBe(`Basic ${expected}`);
	});
});

describe('retries', () => {
	it('retries a server error up to maximumRetries, then reports it', async () => {
		const site = await serve({ '/s': { status: 500 } });
		const result = await createParser({ maximumRetries: 3 }).run(`${site.url}/s`);
		expect(site.hits('/s')).toBe(4);
		expect(result.errors).toEqual([{ url: `${site.url}/s`, reason: 'Unexpected response status (500)' }]);
	});

	it('retries once by default', async () => {
		const site = await serve({ '/s': { status: 503 } });
		await createParser().run(`${site.url}/s`);
		expect(site.hits('/s')).toBe(2);
	});

	it('does not retry when maximumRetries is 0', async () => {
		const site = await serve({ '/s': { status: 500 } });
		await createParser({ maximumRetries: 0 }).run(`${site.url}/s`);
		expect(site.hits('/s')).toBe(1);
	});

	it.each([408, 425, 429, 502])('retries status %i and recovers', async status => {
		const site = await serve({ '/s': ({ hit }) => hit === 1 ? { status } : xml(SITEMAP) });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
		expect(site.hits('/s')).toBe(2);
	});

	it.each([400, 401, 403, 404, 410])('does not retry status %i', async status => {
		const site = await serve({ '/s': { status } });
		const result = await createParser({ maximumRetries: 5 }).run(`${site.url}/s`);
		expect(site.hits('/s')).toBe(1);
		expect(result.errors[0].reason).toBe(`Unexpected response status (${status})`);
	});

	it('retries a dropped connection', async () => {
		const site = await serve({ '/s': ({ hit }) => hit === 1 ? { destroy: true } : xml(SITEMAP) });
		const result = await createParser().run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
	});

	it('does not retry an invalid content type', async () => {
		const site = await serve({ '/s': { type: 'text/html', body: '<html/>' } });
		await createParser({ maximumRetries: 5 }).run(`${site.url}/s`);
		expect(site.hits('/s')).toBe(1);
	});

	it('retries failures independently for each sitemap', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(...['a', 'b', 'c'].map(name => `${base}/${name}.xml`))),
			...Object.fromEntries(['a', 'b', 'c'].map(name => [
				`/${name}.xml`,
				({ hit }: { hit: number }) => hit === 1 ? { status: 500 } : xml(urlset(`https://example.com/${name}`)),
			])),
		});
		const result = await createParser().run(`${site.url}/index.xml`);
		expect(result.errors).toEqual([]);
		expect(result.urls).toHaveLength(3);
	});

	it('retries failures reported with Basic Auth too', async () => {
		const site = await serve({ '/s': { status: 500 } });
		await createParser().run(`${site.url.replace('http://', 'http://user:pass@')}/s`);
		expect(site.hits('/s')).toBe(2);
	});
});

describe('redirects', () => {
	it('follows a redirect to the sitemap', async () => {
		const site = await serve({ '/old.xml': redirect('/new.xml'), '/new.xml': xml(SITEMAP) });
		const result = await createParser().run(`${site.url}/old.xml`);
		expect(result.urls).toEqual(PAGES);
	});

	it('follows a redirect to another origin without sending credentials', async () => {
		const target = await serve({ '/s.xml': xml(SITEMAP) });
		const source = await serve({ '/s.xml': redirect(`${target.url}/s.xml`, 302) });
		const url = source.url.replace('http://', 'http://user:secret@');
		const result = await createParser().run(`${url}/s.xml`);
		expect(result.urls).toEqual(PAGES);
		expect(source.requests[0].headers.authorization).toBeDefined();
		expect(target.requests[0].headers.authorization).toBeUndefined();
	});

	it('gives up on a redirect loop without retrying it', async () => {
		const site = await serve({ '/loop': redirect('/loop') });
		const result = await createParser({ maximumRetries: 3 }).run(`${site.url}/loop`);
		expect(result.errors[0].reason).toContain('Redirect loop');
		expect(site.hits('/loop')).toBeLessThanOrEqual(2);
	});
});

describe('size limits', () => {
	const big = urlset(...Array.from({ length: 200 }, (_, i) => `https://example.com/page-${i}`));

	it('rejects a body that declares a size over maximumResponseSize', async () => {
		const site = await serve({ '/s': xml(big) });
		const result = await createParser({ maximumResponseSize: 1000 }).run(`${site.url}/s`);
		expect(result.urls).toEqual([]);
		expect(result.errors[0].reason).toContain('exceeds the maximum size of 1000 bytes');
	});

	it('rejects a chunked body that grows past maximumResponseSize', async () => {
		const site = await serve({ '/s': xml(big, { chunked: true }) });
		const result = await createParser({ maximumResponseSize: 1000 }).run(`${site.url}/s`);
		expect(result.errors[0].reason).toContain('exceeds the maximum size of 1000 bytes');
		expect(site.hits('/s')).toBe(1);
	});

	it('rejects a small download that inflates past maximumResponseSize', async () => {
		const site = await serve({ '/s': gzipped(' '.repeat(100_000) + SITEMAP) });
		const result = await createParser({ maximumResponseSize: 10_000 }).run(`${site.url}/s`);
		expect(result.errors[0].reason).toContain('once decompressed');
	});

	it('accepts a document exactly at the limit', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		const result = await createParser({ maximumResponseSize: Buffer.byteLength(SITEMAP) }).run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
	});
});

describe('timeout', () => {
	it('gives up on a server that is too slow and reports it', async () => {
		// undici enforces timeouts on a coarse (about half-second) timer, so use a clear gap.
		const site = await serve({ '/s': xml(SITEMAP, { delay: 2000 }) });
		const result = await createParser({ timeout: 300, maximumRetries: 0 }).run(`${site.url}/s`);
		expect(result.urls).toEqual([]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].url).toBe(`${site.url}/s`);
	});
});

describe('proxy', () => {
	it('sends requests through the proxy', async () => {
		const target = await serve({ '/s': xml(SITEMAP) });
		const proxy = await listen(createProxy(createServer()));
		let proxied = 0;
		proxy.server.on('request', () => { proxied++; });
		proxy.server.on('connect', () => { proxied++; });

		const result = await createParser({ proxy: proxy.url }).run(`${target.url}/s`);
		expect(result.urls).toEqual(PAGES);
		expect(proxied).toBeGreaterThan(0);
	});
});

describe('close', () => {
	it('can be called more than once, including through Symbol.asyncDispose', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		const parser = createParser();
		await parser.run(`${site.url}/s`);
		await parser.close();
		await expect(parser.close()).resolves.toBeUndefined();
		await expect(parser[Symbol.asyncDispose]()).resolves.toBeUndefined();
	});

	it('makes later requests fail with an error instead of hanging', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		const parser = createParser({ maximumRetries: 0 });
		await parser.close();
		const result = await parser.run(`${site.url}/s`);
		expect(result.urls).toEqual([]);
		expect(result.errors).toHaveLength(1);
	});
});
