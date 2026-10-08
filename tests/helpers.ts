import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach } from 'vitest';
import { SitemapParser, type SitemapParserConstructorOptions } from '../src';

export interface Reply {
	status?: number;
	type?: string;
	headers?: Record<string, string>;
	body?: Buffer | string;
	/** Wait this many milliseconds before answering. */
	delay?: number;
	/** Drop the connection without answering. */
	destroy?: boolean;
	/** Send the body without a Content-Length, as a chunked response. */
	chunked?: boolean;
}

interface RouteContext {
	/** Base URL of this site, for building absolute links. */
	base: string;
	/** How many times this path has been requested, including this request. */
	hit: number;
}

export type Route = Reply | ((context: RouteContext) => Reply);

export interface Site {
	url: string;
	requests: { path: string; headers: IncomingHttpHeaders }[];
	/** Number of requests made to `path`. */
	hits(path: string): number;
	/** The most requests that were being served at the same moment. */
	peakConcurrency: number;
	/** Requests the client abandoned before the response finished. */
	cancelled: number;
	close(): Promise<void>;
}

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	await Promise.all(closers.splice(0).map(close => close()));
});

export async function listen(server: Server) {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const close = () => new Promise<void>((resolve, reject) => {
		server.close(error => error ? reject(error) : resolve());
		server.closeAllConnections();
	});
	closers.push(close);
	return { server, url, close };
}

/** Starts a local HTTP site. Paths without a route answer 404. Closed after each test. */
export async function serve(routes: Record<string, Route>): Promise<Site> {
	const requests: Site['requests'] = [];
	const hitCounts = new Map<string, number>();
	let active = 0;

	const { url, close } = await listen(createServer((request, response) => {
		const path = request.url!;
		const hit = (hitCounts.get(path) ?? 0) + 1;
		hitCounts.set(path, hit);
		requests.push({ path, headers: request.headers });
		site.peakConcurrency = Math.max(site.peakConcurrency, ++active);
		response.on('close', () => {
			active--;
			if (!response.writableFinished) site.cancelled++;
		});

		const route = routes[path.split('?')[0]];
		const reply = typeof route === 'function' ? route({ base: url, hit }) : route;
		const send = () => {
			if (reply === undefined) return response.writeHead(404).end();
			if (reply.destroy) return request.socket.destroy();
			if (reply.type) response.setHeader('Content-Type', reply.type);
			response.writeHead(reply.status ?? 200, reply.headers);
			if (reply.chunked && reply.body) {
				const body = Buffer.from(reply.body);
				response.write(body.subarray(0, 1));
				response.end(body.subarray(1));
			} else {
				response.end(reply.body);
			}
		};
		if (reply?.delay) setTimeout(send, reply.delay);
		else send();
	}));

	const site: Site = {
		url,
		requests,
		hits: path => hitCounts.get(path) ?? 0,
		peakConcurrency: 0,
		cancelled: 0,
		close,
	};
	return site;
}

/** A parser that retries without waiting and is closed after each test. */
export function createParser(options: SitemapParserConstructorOptions = {}) {
	const parser = new SitemapParser({ retryDelay: 0, ...options });
	closers.push(() => parser.close());
	return parser;
}

export const xml = (body: string, reply: Reply = {}): Reply => ({ type: 'application/xml', body, ...reply });
export const gzipped = (body: string, reply: Reply = {}): Reply => ({ type: 'application/gzip', body: gzipSync(body), ...reply });
export const redirect = (location: string, status = 301): Reply => ({ status, headers: { Location: location } });

/** `<urlset>` of pages. A string becomes `<url><loc>…</loc></url>`; use raw XML for anything else. */
export const urlset = (...pages: string[]) =>
	`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
		pages.map(page => page.startsWith('<') ? page : `<url><loc>${page}</loc></url>`).join('')
	}</urlset>`;

export const sitemapIndex = (...sitemaps: string[]) =>
	`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
		sitemaps.map(url => `<sitemap><loc>${url}</loc></sitemap>`).join('')
	}</sitemapindex>`;
