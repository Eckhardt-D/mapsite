import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SitemapFetcher } from '../src/fetch';

import {
	createErrorServer,
	createHtmlServer,
	createXmlServer,
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

	beforeEach(() => {
		htmlServer = createHtmlServer(); // 4444
		xmlServer = createXmlServer(); // 4445
		errServer = createErrorServer(); // 4446
	});

	afterEach(() => {
		htmlServer.close();
		xmlServer.close();
		errServer.close();
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
});
