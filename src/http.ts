import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Readable } from 'node:stream';
import { Agent, ProxyAgent, interceptors, request, type Dispatcher } from 'undici';
import type { ResolvedOptions } from './options';

const gunzipAsync = promisify(gunzip);

const MAXIMUM_REDIRECTS = 5;
const MAXIMUM_BACKOFF = 10_000;

const ACCEPT = 'text/xml, application/xml, application/rss+xml, application/atom+xml, text/plain, application/gzip';

// Content types accepted when `rejectInvalidContentType` is on.
// Technically zip is not valid for a gzip payload, but some sites send it.
const ALLOWED_CONTENT_TYPES = new Set([
	'text/xml',
	'application/xml',
	'application/rss+xml',
	'application/atom+xml',
	'text/plain',
	'application/gzip',
	'application/x-gzip',
	'application/zip',
]);

// Plain downloads of *.xml.gz are often served as a generic binary type.
const GENERIC_BINARY = 'application/octet-stream';

// undici errors that retrying cannot fix, such as a redirect loop.
const PERMANENT_UNDICI_ERRORS = new Set(['UND_ERR_INVALID_ARG', 'UND_ERR_ABORTED']);

export class FetchError extends Error {
	constructor(message: string, readonly retryable = false, readonly statusCode?: number) {
		super(message);
		this.name = 'FetchError';
	}
}

export const isGzip = (bytes: Buffer) => bytes[0] === 0x1f && bytes[1] === 0x8b;

/** Gunzips `bytes` if they are gzip data, refusing to inflate beyond `limit`. */
export async function inflate(bytes: Buffer, limit: number): Promise<Buffer> {
	if (!isGzip(bytes)) return bytes;
	try {
		return await gunzipAsync(bytes, { maxOutputLength: limit });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
			throw new FetchError(`Response exceeds the maximum size of ${limit} bytes once decompressed.`);
		}
		throw new FetchError(`Invalid gzip data: ${(error as Error).message}`);
	}
}

async function readBody(body: Readable, limit: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of body) {
		size += chunk.length;
		if (size > limit) {
			body.destroy();
			throw new FetchError(`Response exceeds the maximum size of ${limit} bytes.`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks, size);
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

function isRetryable(error: unknown): boolean {
	if (isAbort(error)) return false;
	if (error instanceof FetchError) return error.retryable;
	const code = (error as { code?: unknown }).code;
	return !(typeof code === 'string' && PERMANENT_UNDICI_ERRORS.has(code));
}

export class HttpClient {
	readonly #options: ResolvedOptions;
	readonly #dispatcher: Dispatcher;
	#closing: Promise<void> | undefined;

	constructor(options: ResolvedOptions) {
		this.#options = options;
		const base = options.proxy === undefined
			? new Agent()
			: new ProxyAgent({ uri: options.proxy, connect: { rejectUnauthorized: false } });
		this.#dispatcher = base.compose(interceptors.redirect({ maxRedirections: MAXIMUM_REDIRECTS }));
	}

	/**
	 * Downloads a sitemap and returns its bytes, gunzipped if necessary.
	 * Retries transient failures (network errors, 408, 425, 429, 5xx) with
	 * exponential backoff; anything else fails immediately.
	 */
	async fetch(rawUrl: string, signal?: AbortSignal): Promise<Buffer> {
		const { url, headers } = this.#prepare(rawUrl);

		for (let attempt = 0; ; attempt++) {
			try {
				return await this.#attempt(url, headers, signal);
			} catch (error) {
				if (attempt >= this.#options.maximumRetries || !isRetryable(error)) throw error;
				await sleep(this.#backoff(attempt), undefined, { signal });
			}
		}
	}

	close(): Promise<void> {
		return this.#closing ??= this.#dispatcher.close().then(() => undefined);
	}

	#prepare(rawUrl: string) {
		if (typeof rawUrl !== 'string' || !URL.canParse(rawUrl)) {
			throw new FetchError(`Invalid URL: ${String(rawUrl)}`);
		}
		const url = new URL(rawUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new FetchError(`Unsupported protocol "${url.protocol}", expected http: or https:.`);
		}

		const headers: Record<string, string> = { 'User-Agent': this.#options.userAgent };
		if (this.#options.rejectInvalidContentType) headers['Accept'] = ACCEPT;

		// Credentials in the URL become a Basic Auth header instead.
		if (url.username || url.password) {
			const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
			headers['Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
			url.username = '';
			url.password = '';
		}
		return { url, headers };
	}

	async #attempt(url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<Buffer> {
		const { timeout, maximumResponseSize: limit, rejectInvalidContentType: strict } = this.#options;
		const response = await request(url, {
			dispatcher: this.#dispatcher,
			headers,
			signal,
			headersTimeout: timeout,
			bodyTimeout: timeout,
		});

		const { statusCode } = response;
		if (statusCode < 200 || statusCode >= 300) {
			await response.body.dump();
			const transient = statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
			throw new FetchError(`Unexpected response status (${statusCode})`, transient, statusCode);
		}

		const header = response.headers['content-type'];
		const contentType = String(Array.isArray(header) ? header[0] : header ?? '');
		const mediaType = contentType.split(';')[0].trim().toLowerCase();
		if (strict && !ALLOWED_CONTENT_TYPES.has(mediaType) && mediaType !== GENERIC_BINARY) {
			await response.body.dump();
			throw new FetchError(`Response rejected, invalid "Content-Type" header: ${contentType || 'missing'}.`);
		}

		const length = Number(response.headers['content-length']);
		if (length > limit) {
			response.body.destroy();
			throw new FetchError(`Response exceeds the maximum size of ${limit} bytes.`);
		}

		const bytes = await readBody(response.body, limit);
		if (strict && mediaType === GENERIC_BINARY && !isGzip(bytes)) {
			throw new FetchError(`Response rejected, invalid "Content-Type" header: ${contentType}.`);
		}
		return inflate(bytes, limit);
	}

	#backoff(attempt: number): number {
		const ceiling = Math.min(this.#options.retryDelay * 2 ** attempt, MAXIMUM_BACKOFF);
		return ceiling / 2 + Math.random() * (ceiling / 2);
	}
}
