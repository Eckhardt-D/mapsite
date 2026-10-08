import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createProxy } from 'proxy';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { SitemapFetcher } from '../src/fetch';
import { listen, startServer } from './server';

describe('SitemapFetcher', () => {
	let fixture: Awaited<ReturnType<typeof startServer>>;
	let fetcher: SitemapFetcher;
	let attempts: Record<string, number>;
	let authorization: string | undefined;
	let userAgent: string | undefined;

	beforeAll(async () => {
		fixture = await startServer((request, response) => {
			const path = request.url!;
			attempts[path] = (attempts[path] || 0) + 1;
			authorization = request.headers.authorization;
			userAgent = request.headers['user-agent'];
			if (path === '/error' || (path.startsWith('/flaky') && attempts[path] === 1)) {
				response.writeHead(500).end('error');
				return;
			}
			if (path === '/missing') {
				response.end('<urlset/>');
				return;
			}
			response.setHeader('Content-Type', path === '/html' ? 'text/html' :
				path === '/gzip' ? 'application/gzip' : 'application/xml; charset=utf-8');
			response.end(path === '/gzip' ? gzipSync('<urlset/>') : '<urlset/>');
		});
	});
	beforeEach(() => {
		fetcher = new SitemapFetcher();
		attempts = {};
		authorization = undefined;
	});
	afterAll(async () => { await fixture.close(); });

	it('accepts valid options and removes unknown options', () => {
		const options = { maximumRetries: 3 as const, debug: true, unknown: 'value' };
		const configured = new SitemapFetcher(options);
		expect(configured.maximumRetries).toBe(3);
		expect(configured.debug).toBe(true);
		expect(configured).not.toHaveProperty('unknown');
	});
	it('rejects invalid options', () => {
		expect(() => new SitemapFetcher({ maximumRetries: 0 as 1 })).toThrow();
	});
	it('throws if failed to fetch', async () => {
		await expect(fetcher.fetch('')).rejects.toThrow();
	});
	it('returns XML content as a string', async () => {
		await expect(fetcher.fetch(fixture.url)).resolves.toBe('<urlset/>');
	});
	it('rejects incorrect content types', async () => {
		await expect(fetcher.fetch(`${fixture.url}/html`)).rejects.toThrow('invalid "Content-Type"');
	});
	it('accepts incorrect content types with override', async () => {
		fetcher.rejectInvalidContentType = false;
		await expect(fetcher.fetch(`${fixture.url}/html`)).resolves.toBe('<urlset/>');
	});
	it('accepts missing content type with override', async () => {
		fetcher.rejectInvalidContentType = false;
		await expect(fetcher.fetch(`${fixture.url}/missing`)).resolves.toBe('<urlset/>');
	});
	it('rejects missing content type by default', async () => {
		await expect(fetcher.fetch(`${fixture.url}/missing`)).rejects.toThrow('invalid "Content-Type"');
	});
	it('retries according to maximumRetries', async () => {
		fetcher.maximumRetries = 3;
		await expect(fetcher.fetch(`${fixture.url}/error`)).rejects.toThrow('Unexpected response status (500)');
		expect(attempts['/error']).toBe(4);
		expect(fetcher.currentRetry).toBe(3);
	});
	it('gives each request a fresh retry budget', async () => {
		for (let i = 0; i < 2; i++) {
			await expect(fetcher.fetch(`${fixture.url}/error`)).rejects.toThrow('(500)');
		}
		expect(attempts['/error']).toBe(4);
		await fetcher.fetch(fixture.url);
		expect(fetcher.currentRetry).toBe(0);
	});
	it('keeps concurrent retry budgets independent', async () => {
		await expect(Promise.all(['/flaky-a', '/flaky-b', '/flaky-c'].map(path =>
			fetcher.fetch(fixture.url + path)))).resolves.toEqual(Array(3).fill('<urlset/>'));
		expect(attempts).toEqual({ '/flaky-a': 2, '/flaky-b': 2, '/flaky-c': 2 });
	});
	it('sends a custom user agent', async () => {
		fetcher.userAgent = 'Custom';
		await fetcher.fetch(fixture.url);
		expect(userAgent).toBe('Custom');
	});
	it('retains the default user agent', () => {
		expect(fetcher._makeHeaders()['User-Agent']).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36');
	});
	it('automatically handles gzipped content', async () => {
		await expect(fetcher.fetch(`${fixture.url}/gzip`)).resolves.toBe('<urlset/>');
	});
	it.each(['user:password', 'user:p%40ss', 'user:'])('sends Basic Auth for %s', async credentials => {
		await fetcher.fetch(fixture.url.replace('http://', `http://${credentials}@`));
		expect(authorization).toBe(`Basic ${Buffer.from(decodeURIComponent(credentials)).toString('base64')}`);
	});
	it('rejects and retries HTTP errors with Basic Auth', async () => {
		const url = fixture.url.replace('http://', 'http://user:password@');
		await expect(fetcher.fetch(`${url}/error`)).rejects.toThrow('(500)');
		expect(attempts['/error']).toBe(2);
	});
	it('fetches through an HTTP proxy', async () => {
		const proxy = await listen(createProxy(createServer()));
		const configured = new SitemapFetcher({ proxy: proxy.url });
		let requests = 0;
		proxy.server.on('request', () => { requests++; });
		proxy.server.on('connect', () => { requests++; });
		try {
			await expect(configured.fetch(`${fixture.url}/gzip`)).resolves.toBe('<urlset/>');
			expect(requests).toBeGreaterThan(0);
		} finally {
			await configured.proxyAgent!.close();
			await proxy.close();
		}
	});
});
