import { describe, expect, it } from 'vitest';
import type { MapSiteError, SitemapEntry } from '../src';
import { createParser, serve, sitemapIndex, urlset, xml } from './helpers';

async function collect(iterable: AsyncIterable<SitemapEntry>) {
	const entries: SitemapEntry[] = [];
	for await (const entry of iterable) entries.push(entry);
	return entries;
}

const twoSitemaps = () => serve({
	'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/a.xml`, `${base}/b.xml`)),
	'/a.xml': xml(urlset('https://example.com/a1', 'https://example.com/a2')),
	'/b.xml': xml(urlset('https://example.com/b1')),
});

describe('stream', () => {
	it('yields every entry in the same order as run()', async () => {
		const site = await twoSitemaps();
		const parser = createParser();
		const streamed = await collect(parser.stream(`${site.url}/index.xml`));
		const run = await parser.run(`${site.url}/index.xml`);
		expect(streamed.map(entry => entry.url)).toEqual(['https://example.com/a1', 'https://example.com/a2', 'https://example.com/b1']);
		expect(streamed).toEqual(run.entries);
	});

	it('yields entries with their details', async () => {
		const site = await serve({
			'/s.xml': xml(urlset('<url><loc>https://example.com/</loc><lastmod>2024-05-01</lastmod></url>')),
		});
		const [entry] = await collect(createParser().stream(`${site.url}/s.xml`));
		expect(entry).toEqual({ url: 'https://example.com/', lastmod: '2024-05-01' });
	});

	it('reports failed documents to onError and keeps going', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/missing.xml`, `${base}/b.xml`)),
			'/b.xml': xml(urlset('https://example.com/b1')),
		});
		const errors: MapSiteError[] = [];
		const entries = await collect(createParser().stream(`${site.url}/index.xml`, { onError: error => errors.push(error) }));
		expect(entries.map(entry => entry.url)).toEqual(['https://example.com/b1']);
		expect(errors).toEqual([{ url: `${site.url}/missing.xml`, reason: 'Unexpected response status (404)' }]);
	});

	it('does not need an onError handler', async () => {
		const site = await serve({});
		expect(await collect(createParser().stream(`${site.url}/missing.xml`))).toEqual([]);
	});

	it('stops requesting sitemaps once the consumer stops iterating', async () => {
		const site = await twoSitemaps();
		const stream = createParser({ concurrency: 1 }).stream(`${site.url}/index.xml`);
		for await (const entry of stream) {
			expect(entry.url).toBe('https://example.com/a1');
			break;
		}
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(site.hits('/b.xml')).toBe(0);
	});

	it('cancels requests that are still in flight when the consumer stops iterating', async () => {
		const site = await serve({
			'/index.xml': ({ base }) => xml(sitemapIndex(`${base}/fast.xml`, `${base}/slow.xml`)),
			'/fast.xml': xml(urlset('https://example.com/fast'), { delay: 20 }),
			'/slow.xml': xml(urlset('https://example.com/slow'), { delay: 2000 }),
		});
		for await (const entry of createParser({ concurrency: 2 }).stream(`${site.url}/index.xml`)) {
			expect(entry.url).toBe('https://example.com/fast');
			break;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
		expect(site.cancelled).toBe(1);
	});

	it('rejects with the abort reason', async () => {
		const site = await serve({ '/s.xml': xml(urlset('https://example.com/a'), { delay: 200 }) });
		const controller = new AbortController();
		setTimeout(() => controller.abort(new Error('stop')), 30);
		await expect(collect(createParser().stream(`${site.url}/s.xml`, { signal: controller.signal }))).rejects.toThrow('stop');
	});
});
