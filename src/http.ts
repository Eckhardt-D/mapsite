import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Readable } from 'node:stream';
import { Agent, ProxyAgent, request, type Dispatcher } from 'undici';
import { assertPublicHost, guardedConnector } from './address';
import { bunProxyRequest, isBun } from './bun';
import type { ResolvedOptions } from './options';

const gunzipAsync = promisify(gunzip);

const MAXIMUM_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAXIMUM_BACKOFF = 10_000;

// Statuses that, with `proxyMode: 'fallback'`, send the request again through the proxy.
const FALLBACK_STATUSES = new Set([401, 403, 429]);

// Origins remembered as refusing direct requests, per parser.
const MAXIMUM_REMEMBERED_ORIGINS = 1000;

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

// Errors that retrying cannot fix, such as a redirect loop or a blocked address.
const PERMANENT_ERRORS = new Set(['UND_ERR_INVALID_ARG', 'UND_ERR_ABORTED', 'ERR_MAPSITE_BLOCKED_ADDRESS']);

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

// Bun's response bodies have no undici `dump()`.
async function discard(body: Readable & { dump?: () => Promise<void> }): Promise<void> {
	if (typeof body.dump === 'function') return body.dump();
	body.destroy();
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

function isRetryable(error: unknown): boolean {
	if (isAbort(error)) return false;
	if (error instanceof FetchError) return error.retryable;
	const code = (error as { code?: unknown }).code;
	return !(typeof code === 'string' && PERMANENT_ERRORS.has(code));
}

const isRefusal = (error: unknown) =>
	error instanceof FetchError && error.statusCode !== undefined && FALLBACK_STATUSES.has(error.statusCode);

export class HttpClient {
	readonly #options: ResolvedOptions;
	/** Direct connections; absent when every request goes through the proxy. */
	readonly #direct: Dispatcher | undefined;
	readonly #proxied: Dispatcher | undefined;
	/** Origins that refused a direct request; later requests to them use the proxy straight away. */
	readonly #refusingOrigins = new Set<string>();
	#closing: Promise<void> | undefined;

	constructor(options: ResolvedOptions) {
		this.#options = options;
		// Redirects are followed in #request rather than via `Dispatcher.compose`,
		// which runtimes with their own undici shim (Bun) do not implement.
		if (options.proxy === undefined || options.proxyMode === 'fallback') {
			this.#direct = new Agent(options.blockPrivateAddresses ? { connect: guardedConnector() } : {});
		}
		if (options.proxy !== undefined) {
			this.#proxied = new ProxyAgent({ uri: options.proxy, connect: { rejectUnauthorized: false } });
		}
	}

	/**
	 * Downloads a sitemap and returns its bytes, gunzipped if necessary.
	 * Retries transient failures (network errors, 408, 425, 429, 5xx) with
	 * exponential backoff; anything else fails immediately. In fallback mode a
	 * direct request answered with 401, 403 or 429 is sent again through the
	 * proxy, which does not count as a retry.
	 */
	async fetch(rawUrl: string, signal?: AbortSignal): Promise<Buffer> {
		const { url, headers } = this.#prepare(rawUrl);
		let proxied = this.#direct === undefined || this.#refusingOrigins.has(url.origin);

		for (let retries = 0; ;) {
			try {
				return await this.#attempt(url, headers, proxied, signal);
			} catch (error) {
				if (!proxied && this.#proxied !== undefined && isRefusal(error)) {
					this.#rememberRefusal(url.origin);
					proxied = true;
					continue;
				}
				if (retries >= this.#options.maximumRetries || !isRetryable(error)) throw error;
				await sleep(this.#backoff(retries++), undefined, { signal });
			}
		}
	}

	close(): Promise<void> {
		// Bun's undici shim has no `close`; its connections are released on their own.
		const dispatchers = [this.#direct, this.#proxied].filter(dispatcher => dispatcher !== undefined);
		return this.#closing ??= Promise.all(dispatchers.map(dispatcher => dispatcher.close?.())).then(() => undefined);
	}

	#rememberRefusal(origin: string) {
		this.#refusingOrigins.delete(origin);
		this.#refusingOrigins.add(origin);
		if (this.#refusingOrigins.size > MAXIMUM_REMEMBERED_ORIGINS) {
			this.#refusingOrigins.delete(this.#refusingOrigins.values().next().value!);
		}
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

	async #attempt(url: URL, headers: Record<string, string>, proxied: boolean, signal?: AbortSignal): Promise<Buffer> {
		const { maximumResponseSize: limit, rejectInvalidContentType: strict } = this.#options;
		const response = await this.#request(url, headers, proxied, signal);

		const { statusCode } = response;
		if (statusCode < 200 || statusCode >= 300) {
			await discard(response.body);
			const transient = statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
			throw new FetchError(`Unexpected response status (${statusCode})`, transient, statusCode);
		}

		const header = response.headers['content-type'];
		const contentType = String(Array.isArray(header) ? header.join(', ') : header ?? '');
		// Some servers send duplicated headers, joined as "a; charset=x, b;charset=y".
		const mediaTypes = contentType.split(',').map((part) => part.split(';')[0].trim().toLowerCase());
		const mediaType = mediaTypes.find((type) => ALLOWED_CONTENT_TYPES.has(type))
			?? mediaTypes.find((type) => type === GENERIC_BINARY)
			?? mediaTypes[0];
		if (strict && !ALLOWED_CONTENT_TYPES.has(mediaType) && mediaType !== GENERIC_BINARY) {
			await discard(response.body);
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

	async #request(url: URL, headers: Record<string, string>, proxied: boolean, signal?: AbortSignal) {
		const { timeout, blockPrivateAddresses } = this.#options;
		const visited = new Set<string>();
		for (let redirects = 0; ; redirects++) {
			visited.add(url.href);
			// Checked before every hop as well as in the connector: runtimes whose
			// undici shim ignores custom connectors (Bun) are still covered, except
			// for a DNS answer that changes between this check and the connection.
			if (blockPrivateAddresses && !proxied) await assertPublicHost(url.hostname);
			const response = proxied && isBun
				? await bunProxyRequest(url, headers, this.#options.proxy!, signal)
				: await request(url, {
					dispatcher: proxied ? this.#proxied! : this.#direct!,
					headers,
					signal,
					headersTimeout: timeout,
					bodyTimeout: timeout,
				});

			const location = response.headers['location'];
			if (!REDIRECT_STATUSES.has(response.statusCode) || typeof location !== 'string') return response;

			await discard(response.body);
			if (!URL.canParse(location, url.href)) throw new FetchError(`Invalid redirect location: ${location}`);
			const next = new URL(location, url.href);
			if (visited.has(next.href) || redirects >= MAXIMUM_REDIRECTS) {
				throw new FetchError(`Redirect loop or too many redirects (more than ${MAXIMUM_REDIRECTS}) at ${next.href}.`);
			}
			if (next.protocol !== 'http:' && next.protocol !== 'https:') {
				throw new FetchError(`Unsupported protocol "${next.protocol}", expected http: or https:.`);
			}
			// Never leak credentials to another origin.
			if (next.origin !== url.origin) {
				headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'));
			}
			url = next;
		}
	}

	#backoff(attempt: number): number {
		const ceiling = Math.min(this.#options.retryDelay * 2 ** attempt, MAXIMUM_BACKOFF);
		return ceiling / 2 + Math.random() * (ceiling / 2);
	}
}
