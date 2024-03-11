import { z } from 'zod';
import { ungzip } from 'node-gzip';
import { Dispatcher, ProxyAgent, request } from 'undici';

type OneToTen = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

type StrictContentType = 'text/xml' | 'application/xml' | 'application/rss+xml' | 'application/gzip' | 'application/zip';

const allowedContentTypesWhenStrict: StrictContentType[] = [
	'text/xml',
	'application/xml',
	'application/rss+xml',
	'application/gzip',
	'application/zip'
];

export const oneToTenSchema = z.number().int().min(1).max(10);

export const constructorOptionsSchema = z
	.object({
		rejectInvalidContentType: z.boolean().default(true),
		userAgent: z.string().default('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'),
		maximumRetries: oneToTenSchema.default(1),
		timeout: z.number().default(3000),
		debug: z.boolean().default(false),
		proxy: z.string().optional()
	})
	.default({});

export type SitemapFetcherConstructorOptions = z.input<
  typeof constructorOptionsSchema
>;

export class SitemapFetcher {
	#currentRetry = 0;

	rejectInvalidContentType: boolean;
	maximumRetries: OneToTen;
	maximumDepth: OneToTen;
	userAgent: string;
	timeout: number;
	debug: boolean;

	proxyAgent: ProxyAgent | undefined;

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
		this.maximumRetries = params?.maximumRetries as OneToTen;
		this.userAgent = params?.userAgent;
		this.timeout = params?.timeout;
		this.debug = params?.debug;

		if (params.proxy !== undefined) {
			this.proxyAgent = new ProxyAgent({
				uri: params.proxy,
				connect: {
					rejectUnauthorized: false
				}
			});
		}
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
		const requestCallable = () => {
			const options: Omit<Dispatcher.RequestOptions, 'path' | 'method'> & { dispatcher?: Dispatcher } = {
				throwOnError: true,
				headersTimeout: this.timeout,
				bodyTimeout: this.timeout,
				headers: this.#makeHeaders(),
				maxRedirections: 5,
			}; 

			if (this.proxyAgent !== undefined) {
				options.dispatcher = this.proxyAgent;
			}

			return request(url, options);
		};

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
    
		/**
      * Technically /zip is not valid, but some sites use it
      *  when sending gzipped content.
      */
		const isZipped = ['application/zip', 'application/gzip']
			.some(format => contentTypeHeaders.includes(format));

		if (isZipped) {
			const unzipped = await ungzip(await response.body.arrayBuffer());
			return unzipped.toString();
		}

		return response.body.text();
	}
}
