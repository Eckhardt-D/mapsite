import { describe, expect, it } from 'vitest';
import { createParser, serve, sitemapIndex, urlset, xml } from './helpers';

const robots = (...lines: string[]) => ({ type: 'text/plain', body: lines.join('\n') });

describe('discover', () => {
	it('crawls the sitemaps listed in robots.txt', async () => {
		const site = await serve({
			'/robots.txt': ({ base }) => robots('User-agent: *', 'Disallow: /private', `Sitemap: ${base}/map.xml`),
			'/map.xml': xml(urlset('https://example.com/a')),
		});
		const result = await createParser({ includeEntries: true }).discover(site.url);
		expect(result).toEqual({
			type: 'sitemap',
			urls: ['https://example.com/a'],
			entries: [{ url: 'https://example.com/a' }],
			errors: [],
		});
	});

	it('accepts any URL on the site, not just its origin', async () => {
		const site = await serve({
			'/robots.txt': ({ base }) => robots(`Sitemap: ${base}/map.xml`),
			'/map.xml': xml(urlset('https://example.com/a')),
		});
		const result = await createParser().discover(`${site.url}/some/page?x=1`);
		expect(result.urls).toEqual(['https://example.com/a']);
	});

	it('crawls every listed sitemap and reports an index when there are several', async () => {
		const site = await serve({
			'/robots.txt': ({ base }) => robots(`sitemap: ${base}/a.xml`, `SITEMAP:${base}/b.xml`, `Sitemap: ${base}/a.xml`),
			'/a.xml': xml(urlset('https://example.com/a')),
			'/b.xml': xml(urlset('https://example.com/b')),
		});
		const result = await createParser().discover(site.url);
		expect(result.type).toBe('index');
		expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
		expect(site.hits('/a.xml')).toBe(1);
	});

	it('follows listed indexes', async () => {
		const site = await serve({
			'/robots.txt': ({ base }) => robots(`Sitemap: ${base}/index.xml`),
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml`)),
			'/a.xml': xml(urlset('https://example.com/a')),
		});
		const result = await createParser().discover(site.url);
		expect(result.type).toBe('index');
		expect(result.urls).toEqual(['https://example.com/a']);
	});

	it('resolves a relative Sitemap line against the site', async () => {
		const site = await serve({
			'/robots.txt': robots('Sitemap: /map.xml'),
			'/map.xml': xml(urlset('https://example.com/a')),
		});
		expect((await createParser().discover(site.url)).urls).toEqual(['https://example.com/a']);
	});

	it('falls back to /sitemap.xml when there is no robots.txt', async () => {
		const site = await serve({ '/sitemap.xml': xml(urlset('https://example.com/a')) });
		const result = await createParser().discover(site.url);
		expect(result.urls).toEqual(['https://example.com/a']);
		expect(result.errors).toEqual([]);
	});

	it('falls back to /sitemap.xml when robots.txt lists no sitemap', async () => {
		const site = await serve({
			'/robots.txt': robots('User-agent: *', 'Disallow:'),
			'/sitemap.xml': xml(urlset('https://example.com/a')),
		});
		expect((await createParser().discover(site.url)).urls).toEqual(['https://example.com/a']);
	});

	it('reports a robots.txt that fails, then still tries /sitemap.xml', async () => {
		const site = await serve({
			'/robots.txt': { status: 500 },
			'/sitemap.xml': xml(urlset('https://example.com/a')),
		});
		const result = await createParser().discover(site.url);
		expect(result.urls).toEqual(['https://example.com/a']);
		expect(result.errors).toEqual([{ url: `${site.url}/robots.txt`, reason: 'Unexpected response status (500)' }]);
	});

	it('reports the missing sitemap when the site has nothing', async () => {
		const site = await serve({});
		const result = await createParser().discover(site.url);
		expect(result.urls).toEqual([]);
		expect(result.errors).toEqual([{ url: `${site.url}/sitemap.xml`, reason: 'Unexpected response status (404)' }]);
	});

	it('ignores Sitemap lines that are not http(s) URLs', async () => {
		const site = await serve({
			'/robots.txt': robots('Sitemap: file:///etc/passwd', 'Sitemap: ftp://example.com/map.xml'),
			'/sitemap.xml': xml(urlset('https://example.com/a')),
		});
		expect((await createParser().discover(site.url)).urls).toEqual(['https://example.com/a']);
	});

	it('reports an invalid URL as an error', async () => {
		const result = await createParser().discover('not a url');
		expect(result.errors).toEqual([{ url: 'not a url', reason: 'Invalid URL: not a url' }]);
	});

	it('rejects when aborted', async () => {
		const site = await serve({ '/robots.txt': { ...robots(), delay: 200 } });
		const controller = new AbortController();
		const pending = createParser().discover(site.url, { signal: controller.signal });
		setTimeout(() => controller.abort(new Error('stop')), 30);
		await expect(pending).rejects.toThrow('stop');
	});
});
