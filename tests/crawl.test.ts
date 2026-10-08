import { describe, expect, it } from 'vitest';
import { createParser, serve, sitemapIndex, urlset, xml } from './helpers';

describe('run', () => {
	it('fetches a sitemap', async () => {
		const site = await serve({ '/sitemap.xml': xml(urlset('https://example.com/a')) });
		const result = await createParser({ includeEntries: true }).run(`${site.url}/sitemap.xml`);
		expect(result).toEqual({
			type: 'sitemap',
			urls: ['https://example.com/a'],
			entries: [{ url: 'https://example.com/a' }],
			errors: [],
		});
	});

	it('follows an index to its sitemaps and reports the root as an index', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml`, `${base}/b.xml`)),
			'/a.xml': xml(urlset('https://example.com/a')),
			'/b.xml': xml(urlset('https://example.com/b')),
		});
		const result = await createParser().run(`${site.url}/index.xml`);
		expect(result.type).toBe('index');
		expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
		expect(result.errors).toEqual([]);
	});

	it('lists pages in document order, however long each sitemap takes', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/slow.xml`, `${base}/fast.xml`)),
			'/slow.xml': xml(urlset('https://example.com/slow'), { delay: 100 }),
			'/fast.xml': xml(urlset('https://example.com/fast')),
		});
		const result = await createParser().run(`${site.url}/index.xml`);
		expect(result.urls).toEqual(['https://example.com/slow', 'https://example.com/fast']);
	});

	it('keeps the pages it found when a sitemap fails, and reports the failure', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/missing.xml`, `${base}/good.xml`)),
			'/good.xml': xml(urlset('https://example.com/good')),
		});
		const result = await createParser().run(`${site.url}/index.xml`);
		expect(result.urls).toEqual(['https://example.com/good']);
		expect(result.errors).toEqual([{ url: `${site.url}/missing.xml`, reason: 'Unexpected response status (404)' }]);
	});

	it('reports a failing root as an error, not an exception', async () => {
		const site = await serve({});
		const result = await createParser().run(`${site.url}/nope.xml`);
		expect(result).toEqual({
			type: 'sitemap',
			urls: [],
			errors: [{ url: `${site.url}/nope.xml`, reason: 'Unexpected response status (404)' }],
		});
	});

	it.each([
		['not a URL', 'not a url', 'Invalid URL'],
		['an empty string', '', 'Invalid URL'],
		['a file URL', 'file:///etc/passwd', 'Unsupported protocol'],
	])('reports %s as an error without requesting anything', async (_, url, reason) => {
		const result = await createParser().run(url);
		expect(result.errors).toEqual([{ url, reason: expect.stringContaining(reason) }]);
	});

	it('treats an empty document as an empty sitemap', async () => {
		const site = await serve({ '/empty.xml': xml('') });
		const result = await createParser().run(`${site.url}/empty.xml`);
		expect(result).toEqual({ type: 'sitemap', urls: [], errors: [] });
	});

	it('lets concurrent runs on one parser stay independent', async () => {
		const site = await serve({
			'/a-index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml`)),
			'/b-index.xml': ({ base }) => xml(sitemapIndex(`${base}/b.xml`), { delay: 30 }),
			'/a.xml': xml(urlset('https://example.com/a')),
			'/b.xml': xml(urlset('https://example.com/b')),
		});
		const parser = createParser({ maximumDepth: 1 });
		const [a, b] = await Promise.all([parser.run(`${site.url}/a-index.xml`), parser.run(`${site.url}/b-index.xml`)]);
		expect(a.urls).toEqual(['https://example.com/a']);
		expect(b.urls).toEqual(['https://example.com/b']);
	});

	it('parses an index handed over as a buffer, fetching its sitemaps', async () => {
		const site = await serve({ '/a.xml': xml(urlset('https://example.com/a')) });
		const result = await createParser().fromBuffer(Buffer.from(sitemapIndex(`${site.url}/a.xml`)));
		expect(result.type).toBe('index');
		expect(result.urls).toEqual(['https://example.com/a']);
	});
});

describe('depth', () => {
	// root index -> nested index -> sitemap
	const nested = () => serve({
		'/root.xml': ({ base }) => xml(sitemapIndex(`${base}/nested.xml`)),
		'/nested.xml': ({ base }) => xml(sitemapIndex(`${base}/leaf.xml`)),
		'/leaf.xml': xml(urlset('https://example.com/leaf')),
	});

	it('follows two levels of indexes by default', async () => {
		const site = await nested();
		const result = await createParser().run(`${site.url}/root.xml`);
		expect(result.urls).toEqual(['https://example.com/leaf']);
		expect(result.errors).toEqual([]);
	});

	it('stops at maximumDepth and says which index was not expanded', async () => {
		const site = await nested();
		const result = await createParser({ maximumDepth: 1 }).run(`${site.url}/root.xml`);
		expect(result.urls).toEqual([]);
		expect(result.errors).toEqual([{
			url: `${site.url}/nested.xml`,
			reason: 'Maximum recursive depth reached, more sites available.',
		}]);
		expect(site.hits('/leaf.xml')).toBe(0);
	});

	it('counts depth per branch, not per run', async () => {
		const routes: Parameters<typeof serve>[0] = {};
		const branches = Array.from({ length: 7 }, (_, i) => `/branch-${i}.xml`);
		routes['/root.xml'] = ({ base }) => xml(sitemapIndex(...branches.map(path => base + path)));
		for (const [i, path] of branches.entries()) {
			routes[path] = ({ base }) => xml(sitemapIndex(`${base}/leaf-${i}.xml`));
			routes[`/leaf-${i}.xml`] = xml(urlset(`https://example.com/${i}`));
		}
		const site = await serve(routes);
		const result = await createParser({ maximumDepth: 2 }).run(`${site.url}/root.xml`);
		expect(result.errors).toEqual([]);
		expect(result.urls).toEqual(branches.map((_, i) => `https://example.com/${i}`));
	});
});

describe('duplicates and cycles', () => {
	it('fetches a sitemap listed twice only once and does not repeat its pages', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml`, `${base}/a.xml`)),
			'/a.xml': xml(urlset('https://example.com/a')),
		});
		const result = await createParser().run(`${site.url}/index.xml`);
		expect(result.urls).toEqual(['https://example.com/a']);
		expect(site.hits('/a.xml')).toBe(1);
	});

	it('reports a page once when several sitemaps list it', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml`, `${base}/b.xml`)),
			'/a.xml': xml(urlset('https://example.com/shared', 'https://example.com/a')),
			'/b.xml': xml(urlset('https://example.com/shared', 'https://example.com/b')),
		});
		const result = await createParser().run(`${site.url}/index.xml`);
		expect(result.urls).toEqual(['https://example.com/shared', 'https://example.com/a', 'https://example.com/b']);
	});

	it('terminates on an index that links to itself', async () => {
		const site = await serve({
			'/loop.xml': ({ base }) => xml(sitemapIndex(`${base}/loop.xml`, `${base}/a.xml`)),
			'/a.xml': xml(urlset('https://example.com/a')),
		});
		const result = await createParser({ maximumDepth: 10 }).run(`${site.url}/loop.xml`);
		expect(result.urls).toEqual(['https://example.com/a']);
		expect(site.hits('/loop.xml')).toBe(1);
	});
});

describe('concurrency', () => {
	const fanOut = (children: number, delay: number) => {
		const routes: Parameters<typeof serve>[0] = {
			'/index.xml': ({ base }) => xml(sitemapIndex(...Array.from({ length: children }, (_, i) => `${base}/${i}.xml`))),
		};
		for (let i = 0; i < children; i++) routes[`/${i}.xml`] = xml(urlset(`https://example.com/${i}`), { delay });
		return serve(routes);
	};

	it('fetches up to `concurrency` sitemaps at once', async () => {
		const site = await fanOut(8, 40);
		const result = await createParser({ concurrency: 4 }).run(`${site.url}/index.xml`);
		expect(result.urls).toHaveLength(8);
		expect(site.peakConcurrency).toBe(4);
	});

	it('fetches three at a time by default', async () => {
		const site = await fanOut(8, 40);
		await createParser().run(`${site.url}/index.xml`);
		expect(site.peakConcurrency).toBe(3);
	});

	it('can fetch one at a time', async () => {
		const site = await fanOut(4, 20);
		await createParser({ concurrency: 1 }).run(`${site.url}/index.xml`);
		expect(site.peakConcurrency).toBe(1);
	});
});

describe('cancellation', () => {
	it('rejects with the abort reason and stops fetching', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml`, `${base}/b.xml`)),
			'/a.xml': xml(urlset('https://example.com/a'), { delay: 200 }),
			'/b.xml': xml(urlset('https://example.com/b'), { delay: 200 }),
		});
		const controller = new AbortController();
		const pending = createParser({ concurrency: 1 }).run(`${site.url}/index.xml`, { signal: controller.signal });
		setTimeout(() => controller.abort(new Error('stop')), 50);
		await expect(pending).rejects.toThrow('stop');
		await new Promise(resolve => setTimeout(resolve, 300));
		expect(site.hits('/b.xml')).toBe(0);
	});

	it('rejects immediately for a signal that is already aborted', async () => {
		const site = await serve({ '/sitemap.xml': xml(urlset('https://example.com/a')) });
		await expect(createParser().run(`${site.url}/sitemap.xml`, { signal: AbortSignal.abort() })).rejects.toThrow();
		expect(site.requests).toEqual([]);
	});
});
