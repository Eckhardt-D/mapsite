import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createParser, sitemapIndex, urlset } from './helpers';

const parse = (xml: string | Buffer) => createParser({ includeEntries: true }).fromBuffer(Buffer.from(xml));
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

describe('sitemap', () => {
	it('lists the pages of a sitemap', async () => {
		const result = await parse(urlset('https://example.com/a', 'https://example.com/b'));
		expect(result).toEqual({
			type: 'sitemap',
			urls: ['https://example.com/a', 'https://example.com/b'],
			entries: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
			errors: [],
		});
	});

	it('reports lastmod, changefreq and priority when present', async () => {
		const result = await parse(urlset(
			'<url><loc>https://example.com/</loc><lastmod>2024-05-01</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>',
			'<url><loc>https://example.com/bare</loc></url>',
		));
		expect(result.entries).toEqual([
			{ url: 'https://example.com/', lastmod: '2024-05-01', changefreq: 'daily', priority: 0.8 },
			{ url: 'https://example.com/bare' },
		]);
	});

	it('ignores a priority that is not a number', async () => {
		const result = await parse(urlset('<url><loc>https://example.com/</loc><priority>high</priority></url>'));
		expect(result.entries).toEqual([{ url: 'https://example.com/' }]);
	});

	it('reports hreflang alternates', async () => {
		const result = await parse(
			'<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://example.com/en</loc>' +
			'<xhtml:link rel="alternate" hreflang="de" href="https://example.com/de"/>' +
			'<xhtml:link rel="alternate" href="https://example.com/default"/>' +
			'<xhtml:link rel="stylesheet" href="https://example.com/style.css"/></url></urlset>',
		);
		expect(result.entries).toEqual([{
			url: 'https://example.com/en',
			alternates: [
				{ href: 'https://example.com/de', hreflang: 'de' },
				{ href: 'https://example.com/default' },
			],
		}]);
	});

	it('does not report image or video locations as pages', async () => {
		const result = await parse(urlset(
			'<url><loc>https://example.com/page</loc>' +
			'<image:image><image:loc>https://example.com/photo.png</image:loc></image:image>' +
			'<video:video><video:content_loc>https://example.com/clip.mp4</video:content_loc></video:video></url>',
		));
		expect(result.urls).toEqual(['https://example.com/page']);
	});

	it('decodes entities and trims whitespace around locations', async () => {
		const result = await parse(urlset('<url><loc>\n\t https://example.com/?a=1&amp;b=2 \n</loc></url>'));
		expect(result.urls).toEqual(['https://example.com/?a=1&b=2']);
	});

	it('reads CDATA locations', async () => {
		const result = await parse(urlset('<url><loc><![CDATA[https://example.com/?a=1&b=2]]></loc></url>'));
		expect(result.urls).toEqual(['https://example.com/?a=1&b=2']);
	});

	it('skips entries without a location', async () => {
		const result = await parse(urlset('<url><lastmod>2024-01-01</lastmod></url>', 'https://example.com/ok'));
		expect(result.urls).toEqual(['https://example.com/ok']);
	});

	it.each([
		['prefixed elements', '<ns1:urlset xmlns:ns1="http://www.sitemaps.org/schemas/sitemap/0.9"><ns1:url><ns1:loc>https://example.com/ns</ns1:loc></ns1:url></ns1:urlset>'],
		['a byte order mark', '﻿' + urlset('https://example.com/ns')],
		['an unescaped ampersand', urlset('<url><loc>https://example.com/ns</loc><lastmod>a & b</lastmod></url>')],
		['upper-case element names', '<URLSET><URL><LOC>https://example.com/ns</LOC></URL></URLSET>'],
	])('tolerates %s', async (_, xml) => {
		const result = await parse(xml);
		expect(result.urls).toEqual(['https://example.com/ns']);
		expect(result.errors).toEqual([]);
	});

	it.each(['', '   \n', '<html><body>Not a sitemap</body></html>'])('returns nothing, without errors, for %j', async text => {
		expect(await parse(text)).toEqual({ type: 'sitemap', urls: [], entries: [], errors: [] });
	});

	it('accepts a Uint8Array', async () => {
		const result = await createParser().fromBuffer(new Uint8Array(Buffer.from(urlset('https://example.com/'))));
		expect(result.urls).toEqual(['https://example.com/']);
	});

	it('inflates a gzipped buffer', async () => {
		const result = await parse(gzipSync(urlset('https://example.com/zipped')));
		expect(result.urls).toEqual(['https://example.com/zipped']);
	});

	it('reports corrupt gzip data as an error on "buffer"', async () => {
		const corrupt = gzipSync(urlset('https://example.com/')).subarray(0, 20);
		const result = await parse(corrupt);
		expect(result.urls).toEqual([]);
		expect(result.errors).toEqual([{ url: 'buffer', reason: expect.stringContaining('Invalid gzip data') }]);
	});

	it('refuses to inflate past maximumResponseSize', async () => {
		const bomb = gzipSync(Buffer.alloc(100_000, ' '));
		const result = await createParser({ maximumResponseSize: 1000 }).fromBuffer(bomb);
		expect(result.errors).toEqual([{ url: 'buffer', reason: expect.stringContaining('exceeds the maximum size') }]);
	});
});

describe('sitemap index', () => {
	it('is reported as an index even when it lists nothing', async () => {
		expect(await parse(sitemapIndex())).toEqual({ type: 'index', urls: [], entries: [], errors: [] });
	});

	it('does not report the sitemaps it links to as pages', async () => {
		const result = await createParser({ maximumDepth: 1 }).fromBuffer(
			Buffer.from(sitemapIndex('http://127.0.0.1:1/unreachable.xml')),
		);
		expect(result.urls).toEqual([]);
		expect(result.type).toBe('index');
	});
});

describe('other formats', () => {
	it('reads plain-text sitemaps, one URL per line', async () => {
		const result = await parse('https://example.com/a\r\n\r\n  https://example.com/b  \nnot a url\n# comment\nhttp://example.com/c');
		expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b', 'http://example.com/c']);
	});

	it('reads RSS feeds', async () => {
		const result = await parse(
			'<rss version="2.0"><channel><link>https://example.com/</link>' +
			'<item><link>https://example.com/post-1</link><pubDate>Mon, 06 May 2024 10:00:00 GMT</pubDate></item>' +
			'<item><link>https://example.com/post-2</link></item></channel></rss>',
		);
		expect(result.entries).toEqual([
			{ url: 'https://example.com/post-1', lastmod: 'Mon, 06 May 2024 10:00:00 GMT' },
			{ url: 'https://example.com/post-2' },
		]);
	});

	it('reads Atom feeds', async () => {
		const result = await parse(
			'<feed xmlns="http://www.w3.org/2005/Atom"><link href="https://example.com/"/>' +
			'<entry><link rel="self" href="https://example.com/feed/1"/><link href="https://example.com/post-1"/><updated>2024-05-06T10:00:00Z</updated></entry>' +
			'<entry><link rel="alternate" href="https://example.com/post-2"/></entry></feed>',
		);
		expect(result.entries).toEqual([
			{ url: 'https://example.com/post-1', lastmod: '2024-05-06T10:00:00Z' },
			{ url: 'https://example.com/post-2' },
		]);
	});
});

describe('real-world sitemaps', () => {
	it('reads every page of a sitemap with prefixed elements', async () => {
		const result = await parse(fixture('namespaced.xml'));
		expect(result.errors).toEqual([]);
		expect(result.urls).toHaveLength(48);
		expect(result.urls[0]).toBe('https://www.onfi.com/');
		expect(result.entries?.[1]).toMatchObject({ lastmod: '2017-03-01', changefreq: 'monthly', priority: 0.75 });
	});

	it('reads every page of a large sitemap', async () => {
		const result = await parse(fixture('edgecase1.xml'));
		expect(result.errors).toEqual([]);
		expect(result.urls).toHaveLength(400);
	});
});
