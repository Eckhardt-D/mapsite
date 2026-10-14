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

const viaProxy = (site: { requests: { headers: Record<string, unknown> }[] }) =>
	site.requests.map(request => request.headers.via !== undefined);

async function startProxy() {
	const proxy = await listen(createProxy(createServer()));
	let requests = 0;
	proxy.server.on('request', () => { requests++; });
	proxy.server.on('connect', () => { requests++; });
	return { url: proxy.url, requests: () => requests };
}

describe('proxy fallback', () => {
	it.each([401, 403, 429])('repeats a request answered with %i through the proxy', async status => {
		const site = await serve({ '/s': ({ hit }) => hit === 1 ? { status } : xml(SITEMAP) });
		const proxy = await startProxy();
		const result = await createParser({ proxy: proxy.url, proxyMode: 'fallback', maximumRetries: 0 }).run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
		expect(result.errors).toEqual([]);
		expect(viaProxy(site)).toEqual([false, true]);
	});

	it('fetches directly when the site answers', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		const proxy = await startProxy();
		const result = await createParser({ proxy: proxy.url, proxyMode: 'fallback' }).run(`${site.url}/s`);
		expect(result.urls).toEqual(PAGES);
		expect(viaProxy(site)).toEqual([false]);
		expect(proxy.requests()).toBe(0);
	});

	it.each([404, 500])('does not use the proxy for %i', async status => {
		const site = await serve({ '/s': { status } });
		const proxy = await startProxy();
		const result = await createParser({ proxy: proxy.url, proxyMode: 'fallback' }).run(`${site.url}/s`);
		expect(result.errors).toHaveLength(1);
		expect(proxy.requests()).toBe(0);
	});

	it('reports the proxied failure when the proxy is refused too', async () => {
		const site = await serve({ '/s': { status: 403 } });
		const proxy = await startProxy();
		const result = await createParser({ proxy: proxy.url, proxyMode: 'fallback' }).run(`${site.url}/s`);
		expect(result.errors).toEqual([{ url: `${site.url}/s`, reason: 'Unexpected response status (403)' }]);
		expect(viaProxy(site)).toEqual([false, true]);
	});

	it('sends later requests to a refusing origin straight through the proxy', async () => {
		const site = await serve({
			'/index': ({ base, hit }) => hit === 1 ? { status: 403 } : xml(sitemapIndex(`${base}/a`, `${base}/b`)),
			'/a': xml(urlset('https://example.com/a')),
			'/b': xml(urlset('https://example.com/b')),
		});
		const proxy = await startProxy();
		const result = await createParser({ proxy: proxy.url, proxyMode: 'fallback' }).run(`${site.url}/index`);
		expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
		expect(viaProxy(site)).toEqual([false, true, true, true]);
	});
});

describe('blockPrivateAddresses', () => {
	it('refuses IP literals without retrying', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		// A retry would wait out the delay and time the test out.
		const parser = createParser({ blockPrivateAddresses: true, maximumRetries: 3, retryDelay: 60_000 });
		const result = await parser.run(`${site.url}/s`);
		expect(result.urls).toEqual([]);
		expect(result.errors).toEqual([{ url: `${site.url}/s`, reason: 'Refusing to connect to 127.0.0.1: not a public address.' }]);
		expect(site.hits('/s')).toBe(0);
	});

	it('refuses hostnames that resolve to a private address', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		const url = site.url.replace('127.0.0.1', 'localhost');
		const result = await createParser({ blockPrivateAddresses: true }).run(`${url}/s`);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].reason).toMatch(/^Refusing to connect to (127\.0\.0\.1|::1): not a public address\.$/);
		expect(site.hits('/s')).toBe(0);
	});

	it('does not fall back to the proxy for a refused address', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		const proxy = await startProxy();
		const result = await createParser({ blockPrivateAddresses: true, proxy: proxy.url, proxyMode: 'fallback' }).run(`${site.url}/s`);
		expect(result.errors).toHaveLength(1);
		expect(proxy.requests()).toBe(0);
	});

	it('is off by default', async () => {
		const site = await serve({ '/s': xml(SITEMAP) });
		expect((await createParser().run(`${site.url}/s`)).urls).toEqual(PAGES);
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
