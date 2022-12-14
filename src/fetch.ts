import { z } from 'zod';
import { Dispatcher, request } from 'undici';

type OneToTen = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

type StrictContentType = 'text/xml' | 'application/xml' | 'application/rss+xml';

export interface SitemapFetcherConstructorOptions {
  rejectInvalidContentType?: boolean;
  userAgent?: string;
  maximumRetries?: OneToTen;
  timeout?: number;
  debug?: boolean;
}

const allowedContentTypesWhenStrict: StrictContentType[] = [
	'text/xml',
	'application/xml',
	'application/rss+xml',
];

export const oneToTenSchema = z.number().int().min(1).max(10);

export const constructorOptionsSchema = z
	.object({
		rejectInvalidContentType: z.boolean().default(true),
		userAgent: z.string().default('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36 mapsite/1.0'),
		maximumRetries: oneToTenSchema.default(1),
		timeout: z.number().default(3000),
		debug: z.boolean().default(false),
	})
	.default({
		rejectInvalidContentType: true,
		userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36 mapsite/1.0',
		maximumRetries: 1,
		timeout: 3000,
		debug: false,
	});

export class SitemapFetcher {
	#currentRetry = 0;

	rejectInvalidContentType: boolean;
	maximumRetries: OneToTen;
	maximumDepth: OneToTen;
	userAgent: string;
	timeout: number;
	debug: boolean;

	/**
   * The number of retry the
   * fetcher is currently on
   */
	get currentRetry() {
		return this.#currentRetry;
	}

	constructor(options?: SitemapFetcherConstructorOptions) {
		const params = constructorOptionsSchema.parse(
			options
		) as Required<SitemapFetcherConstructorOptions>;

		this.rejectInvalidContentType = params?.rejectInvalidContentType;
		this.maximumRetries = params?.maximumRetries;
		this.userAgent = params?.userAgent;
		this.timeout = params?.timeout;
		this.debug = params?.debug;
	}

	#makeHeaders() {
		const headers: HeadersInit = {};

		if (this.rejectInvalidContentType) {
			headers['Accept'] = 'text/xml, application/xml, application/rss+xml';
		}

		headers['User-Agent'] = this.userAgent;

		return headers;
	}

	_makeHeaders() {
		return this.#makeHeaders();
	}

	async #fetchWithRetries(
		requestFn: () => Promise<Dispatcher.ResponseData>
	): Promise<Dispatcher.ResponseData> {
		try {
			return await requestFn();
		} catch (error) {
			if (this.#currentRetry >= this.maximumRetries) {
				throw error;
			}

			this.#currentRetry += 1;
			return this.#fetchWithRetries(requestFn);
		}
	}

	async fetch(url: string) {
		const requestCallable = () =>
			request(url, {
				throwOnError: true,
				headersTimeout: this.timeout,
				bodyTimeout: this.timeout,
				headers: this.#makeHeaders(),
				maxRedirections: 2,
			});

		const response = await this.#fetchWithRetries(requestCallable);
		const contentTypeHeaders = response.headers['content-type'];

		if (this.rejectInvalidContentType) {
			const includesHeader = allowedContentTypesWhenStrict.some(
				(allowedContentType) => {
					return contentTypeHeaders?.includes(allowedContentType);
				}
			);

			/**
       * @todo instead of includes, should we check for only
       * the specific value and nothing else (except charset).
       */
			if (!includesHeader) {
				throw new Error(
					`Response rejected, invalid "Content-Type" header: ${
						contentTypeHeaders
					}.`
				);
			}
		}

		return response.body.text();
	}
}
