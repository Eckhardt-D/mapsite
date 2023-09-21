import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SitemapFetcher } from '../src/fetch';

import {
	createErrorServer,
	createHtmlServer,
	createXmlServer,
	createGzippedServer,
} from './server';

describe('SitemapFetcher.constructor', () => {
	it('accepts valid options', () => {
		const options = {
			rejectInvalidContentType: true,
			maximumRetries: 3 as const,
			timeout: 3000,
			debug: false,
			unknown: 'string',
		};

		const fetcher = new SitemapFetcher(options);
		expect(fetcher.maximumRetries).toBe(options.maximumRetries);
		expect(fetcher.debug).toBe(options.debug);

		// @ts-ignore:TS2339
		expect(fetcher.unknown).toBeUndefined();
	});
});

describe('SitemapFetcher.fetch', () => {
	const fetcher = new SitemapFetcher();

	let htmlServer;
	let xmlServer;
	let errServer;
	let gzippedServer;

	beforeEach(() => {
		htmlServer = createHtmlServer(); // 4444
		xmlServer = createXmlServer(); // 4445
		errServer = createErrorServer(); // 4446
		gzippedServer = createGzippedServer(); // 4452
	});

	afterEach(() => {
		htmlServer.close();
		xmlServer.close();
		errServer.close();
		gzippedServer.close();
		vi.restoreAllMocks();
	});

	it('throws if failed to fetch', async () => {
		await expect(fetcher.fetch('')).rejects.toThrow();
	});

	it('fetches a remote URL', async () => {
		await expect(
			fetcher.fetch('http://localhost:4445')
		).resolves.toBeDefined();
	});

	it('rejects incorrect content-types', async () => {
		await expect(
			fetcher.fetch('http://localhost:4444')
		).rejects.toThrow('Response rejected, invalid "Content-Type" header:');
	});

	it('accepts incorrect content-types with override', async () => {
		fetcher.rejectInvalidContentType = false;

		await expect(
			fetcher.fetch('http://localhost:4444')
		).resolves.toBeDefined();
	});

	it('retries according to maximumRetries', async () => {
		fetcher.maximumRetries = 3;
		await expect(
			fetcher.fetch('http://localhost:4446')
		).rejects.toThrow('Response status code 500: Internal Server Error');
		expect(fetcher.currentRetry).toBe(3);
	});

	it('returns the response content as a string', async () => {
		const response = await fetcher.fetch('http://localhost:4445');
		expect(typeof response).toBe('string');
	});

	it('accepts a custom user agent', async () => {
		const fetcher2 = new SitemapFetcher({
			userAgent: 'Custom'
		});

		await fetcher.fetch('http://localhost:4445');
		expect(fetcher2._makeHeaders()['User-Agent']).toBe('Custom');
	});

	it('has a default user agent', async () => {
		const fetcher2 = new SitemapFetcher();

		await fetcher.fetch('http://localhost:4445');
		expect(fetcher2._makeHeaders()['User-Agent']).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36 mapsite/1.0');
	});

	it('automatically handles gzipped fetches', async () => {
		const fetcher2 = new SitemapFetcher();

		const response = await fetcher2.fetch('http://localhost:4452');
		expect(response).toMatch('<?xml version="1.0"');
	});
});
