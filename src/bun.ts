import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';

/** Whether this is Bun, whose built-in `undici` ignores `dispatcher` and so `ProxyAgent`. */
export const isBun = typeof process !== 'undefined' && process.versions?.bun !== undefined;

/**
 * One request through `proxy` with Bun's `fetch`, which takes the proxy as an
 * option. Redirects are not followed, and the result has the shape of Bun's
 * undici `request()`. As with `ProxyAgent`, the target's TLS certificate is not
 * verified.
 */
export async function bunProxyRequest(url: URL, headers: Record<string, string>, proxy: string, signal?: AbortSignal) {
	const response = await fetch(url, {
		headers,
		signal,
		redirect: 'manual',
		proxy,
		tls: { rejectUnauthorized: false },
	} as RequestInit);
	const body = response.body === null
		? Readable.from([])
		: Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
	return { statusCode: response.status, headers: Object.fromEntries(response.headers), body };
}
