import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SitemapParser } from '../src';
import { SitemapFetcher } from '../src/fetch';

const sitemap = (url: string) => `<urlset><url><loc>${url}</loc></url></urlset>`;
const index = (...urls: string[]) => `<sitemapindex>${urls.map(url =>
	`<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`;

function mockDocuments(documents: Record<string, string>) {
	return vi.spyOn(SitemapFetcher.prototype, 'fetch').mockImplementation(async url => {
		if (!(url in documents)) throw new Error('Unavailable sitemap');
		return documents[url];
	});
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function finish<T>(promise: Promise<T>): Promise<T> {
	await vi.runAllTimersAsync();
	return promise;
}

describe('parser maintenance regressions', () => {
	it('applies the default depth when only another option is supplied', async () => {
		mockDocuments({ root: index('child'), child: sitemap('https://example.com/') });
		const parser = new SitemapParser({ userAgent: 'Custom' });
		expect(parser.maximumDepth).toBe(2);
		await expect(finish(parser.run('root'))).resolves.toEqual({
			type: 'sitemap', urls: ['https://example.com/'], errors: [],
		});
	});
	it('resets depth between run and fromBuffer calls', async () => {
		mockDocuments({ root: index('child'), child: sitemap('https://example.com/') });
		const parser = new SitemapParser({ maximumDepth: 1 });
		for (let i = 0; i < 2; i++) {
			expect((await finish(parser.run('root'))).errors).toEqual([]);
		}
		expect((await finish(parser.fromBuffer(Buffer.from(index('child'))))).errors).toEqual([]);
		await finish(parser.fromBuffer(Buffer.from(sitemap('https://example.com/'))));
		expect(parser.currentDepth).toBe(0);
	});
	it('counts depth per branch, including sibling indexes across batches', async () => {
		const documents: Record<string, string> = {};
		const branches = Array.from({ length: 7 }, (_, i) => `branch-${i}`);
		documents.root = index(...branches);
		for (const branch of branches) {
			documents[branch] = index(`${branch}-leaf`);
			documents[`${branch}-leaf`] = sitemap(`https://example.com/${branch}`);
		}
		mockDocuments(documents);
		const parser = new SitemapParser({ maximumDepth: 2 });
		const result = await finish(parser.run('root'));
		expect(result.errors).toEqual([]);
		expect(result.urls.sort()).toEqual(branches.map(branch => `https://example.com/${branch}`).sort());
		expect(parser.currentDepth).toBe(2);
	});
	it('keeps concurrent runs independent', async () => {
		mockDocuments({ a: index('a-leaf'), b: index('b-leaf'),
			'a-leaf': sitemap('https://example.com/a'), 'b-leaf': sitemap('https://example.com/b') });
		const parser = new SitemapParser({ maximumDepth: 1 });
		const results = await finish(Promise.all([parser.run('a'), parser.run('b')]));
		expect(results.map(result => result.errors)).toEqual([[], []]);
		expect(results.map(result => result.urls)).toEqual([
			['https://example.com/a'], ['https://example.com/b'],
		]);
	});
	it('collects a failed child while retaining successful siblings', async () => {
		mockDocuments({ root: index('missing', 'good'), good: sitemap('https://example.com/') });
		const result = await finish(new SitemapParser().run('root'));
		expect(result.urls).toEqual(['https://example.com/']);
		expect(result.errors).toEqual([{ url: 'missing', reason: 'Unavailable sitemap' }]);
	});
	it('preserves entity decoding and media exclusion', async () => {
		const xml = '<urlset><url><loc>https://example.com/plain</loc>' +
			'<image:image><image:loc>https://example.com/image.png</image:loc></image:image></url>' +
			'<url><loc>https://example.com/?a=1&amp;b=2</loc></url></urlset>';
		const result = await finish(new SitemapParser().fromBuffer(Buffer.from(xml)));
		expect(result.urls).toEqual(['https://example.com/plain', 'https://example.com/?a=1&b=2']);
	});
});
