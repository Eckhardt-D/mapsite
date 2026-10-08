import { describe, expect, it } from 'vitest';
import { SitemapParser, type SitemapParserConstructorOptions } from '../src';
import { createParser, serve, urlset, xml } from './helpers';

describe('options', () => {
	it('works without options', async () => {
		const site = await serve({ '/s.xml': xml(urlset('https://example.com/')) });
		const result = await new SitemapParser().run(`${site.url}/s.xml`);
		expect(result.urls).toEqual(['https://example.com/']);
	});

	it('leaves out entries unless includeEntries is set', async () => {
		const site = await serve({ '/s.xml': xml(urlset('https://example.com/')) });
		const off = await createParser().run(`${site.url}/s.xml`);
		expect(off).not.toHaveProperty('entries');
		expect(off.urls).toEqual(['https://example.com/']);
		const on = await createParser({ includeEntries: true }).run(`${site.url}/s.xml`);
		expect(on.entries).toEqual([{ url: 'https://example.com/' }]);
	});

	it('accepts every documented option', () => {
		const options: SitemapParserConstructorOptions = {
			rejectInvalidContentType: false,
			userAgent: 'test',
			maximumRetries: 0,
			maximumDepth: 10,
			timeout: 500,
			proxy: 'http://proxy.example:3128',
			concurrency: 20,
			maximumResponseSize: 1024,
			retryDelay: 0,
			includeEntries: true,
		};
		expect(() => new SitemapParser(options)).not.toThrow();
	});

	it('ignores options it does not know', () => {
		expect(() => new SitemapParser({ debug: true } as SitemapParserConstructorOptions)).not.toThrow();
	});

	it.each([
		['rejectInvalidContentType', 'yes'],
		['userAgent', 42],
		['maximumRetries', -1],
		['maximumRetries', 11],
		['maximumRetries', 1.5],
		['maximumDepth', 0],
		['maximumDepth', 11],
		['timeout', 0],
		['timeout', Number.NaN],
		['concurrency', 0],
		['concurrency', 21],
		['maximumResponseSize', 0],
		['retryDelay', -1],
		['includeEntries', 'yes'],
		['proxy', 'not a url'],
		['proxy', 'ftp://proxy.example'],
	])('rejects %s = %j, naming the option', (name, value) => {
		expect(() => new SitemapParser({ [name]: value } as SitemapParserConstructorOptions))
			.toThrow(new RegExp(`"${name}"`));
	});

	it.each([null, 'options', [], 42])('rejects %j as the options object', value => {
		expect(() => new SitemapParser(value as SitemapParserConstructorOptions)).toThrow('Options must be an object');
	});

	it('uses the same defaults whether or not other options are given', async () => {
		const site = await serve({ '/e': { status: 500 } });
		await createParser().run(`${site.url}/e`);
		const withDefaults = site.hits('/e');
		await createParser({ userAgent: 'other' }).run(`${site.url}/e`);
		expect(site.hits('/e') - withDefaults).toBe(withDefaults);
	});
});
