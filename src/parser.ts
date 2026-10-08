import { crawl, type CrawlRoot } from './crawl';
import { FetchError, HttpClient, inflate } from './http';
import { resolveOptions, type ResolvedOptions, type SitemapParserConstructorOptions } from './options';
import { parseRobots } from './robots';
import type { MapSiteError, MapSiteResponse, RequestOptions, SitemapEntry, StreamOptions } from './types';

export class SitemapParser implements AsyncDisposable {
	readonly #options: ResolvedOptions;
	readonly #http: HttpClient;

	constructor(options?: SitemapParserConstructorOptions) {
		this.#options = resolveOptions(options);
		this.#http = new HttpClient(this.#options);
	}

	/** Fetches a sitemap or sitemap index and every sitemap it links to. */
	run(url: string, options: RequestOptions = {}): Promise<MapSiteResponse> {
		return this.#collect([this.#remote(url)], options);
	}

	/** Parses a sitemap you already have. Links in an index are still fetched. */
	fromBuffer(buffer: Buffer | Uint8Array, options: RequestOptions = {}): Promise<MapSiteResponse> {
		const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
		const root: CrawlRoot = {
			url: 'buffer',
			load: () => inflate(bytes, this.#options.maximumResponseSize),
		};
		return this.#collect([root], options);
	}

	/**
	 * Finds a site's sitemaps through the `Sitemap:` lines of its robots.txt,
	 * falling back to /sitemap.xml, and crawls all of them. Pass any URL on the site.
	 */
	async discover(site: string, options: RequestOptions = {}): Promise<MapSiteResponse> {
		if (typeof site !== 'string' || !URL.canParse(site)) {
			return { type: 'sitemap', urls: [], ...(this.#options.includeEntries && { entries: [] }), errors: [{ url: String(site), reason: `Invalid URL: ${String(site)}` }] };
		}

		const robotsUrl = new URL('/robots.txt', site);
		const errors: MapSiteError[] = [];
		let sitemaps: string[] = [];
		try {
			const robots = await this.#http.fetch(robotsUrl.href, options.signal);
			sitemaps = parseRobots(robots.toString('utf8'), robotsUrl);
		} catch (error) {
			options.signal?.throwIfAborted();
			const status = error instanceof FetchError ? error.statusCode : undefined;
			// A site without a robots.txt is normal; anything else is worth reporting.
			if (status === undefined || status < 400 || status >= 500) {
				errors.push({ url: robotsUrl.href, reason: (error as Error).message });
			}
		}
		if (sitemaps.length === 0) sitemaps = [new URL('/sitemap.xml', site).href];

		const response = await this.#collect(sitemaps.map(url => this.#remote(url)), options);
		response.errors.unshift(...errors);
		return response;
	}

	/**
	 * Yields pages as they are found, without holding the whole result in memory.
	 * Stop iterating to cancel the remaining requests. Failed documents are
	 * reported through `onError`.
	 */
	async *stream(url: string, options: StreamOptions = {}): AsyncGenerator<SitemapEntry> {
		const events = crawl([this.#remote(url)], this.#crawlOptions(options));
		for await (const event of events) {
			if (event.kind === 'entry') yield event.entry;
			else if (event.kind === 'error') options.onError?.(event.error);
		}
	}

	/** Releases pooled connections. The parser cannot be used afterwards. */
	close(): Promise<void> {
		return this.#http.close();
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.close();
	}

	#remote(url: string): CrawlRoot {
		return { url, load: signal => this.#http.fetch(url, signal) };
	}

	#crawlOptions(options: RequestOptions) {
		return {
			maximumDepth: this.#options.maximumDepth,
			concurrency: this.#options.concurrency,
			loadChild: (url: string, signal: AbortSignal) => this.#http.fetch(url, signal),
			signal: options.signal,
		};
	}

	async #collect(roots: CrawlRoot[], options: RequestOptions): Promise<MapSiteResponse> {
		const entries: SitemapEntry[] | undefined = this.#options.includeEntries ? [] : undefined;
		const response: MapSiteResponse = { type: 'sitemap', urls: [], ...(entries && { entries }), errors: [] };

		for await (const event of crawl(roots, this.#crawlOptions(options))) {
			if (event.kind === 'root') {
				if (event.type === 'index' || roots.length > 1) response.type = 'index';
			} else if (event.kind === 'entry') {
				response.urls.push(event.entry.url);
				entries?.push(event.entry);
			} else {
				response.errors.push(event.error);
			}
		}
		return response;
	}
}
