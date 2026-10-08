export interface SitemapParserConstructorOptions {
	/** Only accept XML, text and gzip content types. Default: `true`. */
	rejectInvalidContentType?: boolean;
	userAgent?: string;
	/** Extra attempts after a transient failure, 0 to 10. Default: `1`. */
	maximumRetries?: number;
	/** How many levels of sitemap indexes to follow, 1 to 10. Default: `2`. */
	maximumDepth?: number;
	/** Milliseconds a request may wait for headers or for more body data. Default: `3000`. */
	timeout?: number;
	/** URL of an HTTP(S) proxy to send requests through. */
	proxy?: string;
	/** Documents fetched at the same time, 1 to 20. Default: `3`. */
	concurrency?: number;
	/** Largest accepted document in bytes, before and after decompression. Default: 50 MiB. */
	maximumResponseSize?: number;
	/** Base delay in milliseconds for exponential retry backoff. Default: `250`. */
	retryDelay?: number;
	/** Also return `entries` (lastmod, changefreq, priority, alternates) on results. Default: `false`. */
	includeEntries?: boolean;
}

export interface ResolvedOptions {
	readonly rejectInvalidContentType: boolean;
	readonly userAgent: string;
	readonly maximumRetries: number;
	readonly maximumDepth: number;
	readonly timeout: number;
	readonly proxy: string | undefined;
	readonly concurrency: number;
	readonly maximumResponseSize: number;
	readonly retryDelay: number;
	readonly includeEntries: boolean;
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

type Input = Record<string, unknown>;

function invalid(name: string, expected: string): never {
	throw new TypeError(`Invalid option "${name}": expected ${expected}.`);
}

function boolean(input: Input, name: string, fallback: boolean): boolean {
	const value = input[name];
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') invalid(name, 'a boolean');
	return value;
}

function number(input: Input, name: string, fallback: number, min: number, max: number, integer: boolean): number {
	const value = input[name];
	if (value === undefined) return fallback;
	const kind = integer ? 'an integer' : 'a number';
	const range = max === Infinity ? `at least ${min}` : `from ${min} to ${max}`;
	if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
		invalid(name, `${kind} ${range}`);
	}
	return value;
}

function proxy(input: Input): string | undefined {
	const value = input.proxy;
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || !URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
		invalid('proxy', 'an http:// or https:// URL');
	}
	return value;
}

export function resolveOptions(options: SitemapParserConstructorOptions | undefined): ResolvedOptions {
	if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
		throw new TypeError('Options must be an object.');
	}
	const input: Input = { ...options };
	const userAgent = input.userAgent ?? DEFAULT_USER_AGENT;
	if (typeof userAgent !== 'string') invalid('userAgent', 'a string');

	return {
		rejectInvalidContentType: boolean(input, 'rejectInvalidContentType', true),
		userAgent,
		maximumRetries: number(input, 'maximumRetries', 1, 0, 10, true),
		maximumDepth: number(input, 'maximumDepth', 2, 1, 10, true),
		timeout: number(input, 'timeout', 3000, 1, Infinity, false),
		proxy: proxy(input),
		concurrency: number(input, 'concurrency', 3, 1, 20, true),
		maximumResponseSize: number(input, 'maximumResponseSize', 50 * 1024 * 1024, 1, Infinity, true),
		retryDelay: number(input, 'retryDelay', 250, 0, Infinity, false),
		includeEntries: boolean(input, 'includeEntries', false),
	};
}
