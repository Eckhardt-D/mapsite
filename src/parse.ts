import {
	oneToTenSchema,
	SitemapFetcher,
	SitemapFetcherConstructorOptions,
} from './fetch';

import { z } from 'zod';
import { load as loadHTML } from 'cheerio';

interface SitemapParserOptions {
  maximumDepth?: number;
}

interface MapSiteError {
  url: string;
  reason: string;
}

const sitemapParserConstructorOptionsSchema = z
	.object({
		maximumDepth: oneToTenSchema.optional(),
		rejectInvalidContentType: z.boolean().optional(),
		maximumRetries: oneToTenSchema.optional(),
		userAgent: z.string().optional(),
		timeout: z.number().optional(),
		debug: z.boolean().optional(),
		proxy: z.string().optional(),
	})
	.default({
		maximumDepth: 2,
		rejectInvalidContentType: true,
		maximumRetries: 3,
		timeout: 3000,
		debug: false,
	});

export type SitemapParserConstructorOptions = SitemapFetcherConstructorOptions &
  SitemapParserOptions;

export interface MapSiteResponse {
  type: 'sitemap' | 'index';
  urls: string[];
  errors: MapSiteError[];
}

export class SitemapParser {
	#fetcher: SitemapFetcher;
	#currentDepth = 0;
	maximumDepth: number;

	constructor(options?: SitemapParserConstructorOptions) {
		const params = sitemapParserConstructorOptionsSchema.parse(
			options
		) as SitemapParserConstructorOptions;

		const { maximumDepth, ...rest } = params;

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.maximumDepth = maximumDepth!; // Will be set by Zod
		this.#fetcher = new SitemapFetcher(rest);
	}

	get currentDepth() {
		return this.#currentDepth;
	}

	static getLinesFromText(text: string): string[] {
		return (
			text
			// Delete all line breaks
				.replace(/\n/g, '')
			// Make sure <loc>url</loc> has its own line
				.replace(/<((?!(image|video))[A-z0-9:]+)?loc>/g, '\n<loc>')
			// Make sure <loc>url</loc> has its own line
				.replace(/<\/((?!(image|video))[A-z0-9:]+)?loc>/g, '</loc>\n')
			// Make sure <sitemap> has its own line
				.replace(/<([A-z0-9:]+)?sitemap>/g, '\n<sitemap>')
			// Make sure <sitemap> has its own line
				.replace(/<\/([A-z0-9:]+)?sitemap>/g, '</sitemap>\n')
			// Remove tabs
				.replace(/\t+/g, '')
				.split('\n')
		);
	}

	#getTextFromBuffer(buffer: Buffer): string {
		return buffer.toString('utf-8');
	}

	#getURLsFromLines(lines: string[]): string[] {
		const result = [];
		const locMatcher = /<(.*:)?loc>(.*)<\/(.*:)?loc>/g;

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];

			if (!line.includes('loc>')) continue;
			line = line.trim().replace(/\s+/g, '');
			/**
			 * Do not includes google's media tags in the response
			 */
			if (line.includes('image:image') || line.includes('video:video')) continue;
			const matched = line.matchAll(locMatcher);
			const array = [...matched];

			if (!array.length) continue;

			const url = array[0][2];

			if (url) {
				result.push(url);
			}
		}

		return result;
	}

	async #parseWithCheerio(
		url: string,
		text: string,
		response: MapSiteResponse = {
			type: 'sitemap',
			urls: [],
			errors: [],
		}
	): Promise<MapSiteResponse> {
		try {
			// First convert all namespaced :loc to loc
			// This is because cheerio does not support namespaced tags
			// ignore media namespaced items
			text = text.replace(/<((?!(image|video))[A-z0-9]+):loc>/g, '<loc>');
			text = text.replace(/<\/((?!(image|video))[A-z0-9]+):loc>/g, '</loc>');

			const $ = loadHTML(text, {
				decodeEntities: false,
			});

			// First check if the sitemap is an index
			const isIndexFile = $('sitemapindex').length > 0;

			response.type = isIndexFile ? 'index' : 'sitemap';

			if (text.length < 1) {
				return response;
			}

			// Using: Cheeerio
			// Then we need to collect all the urls of the index file
			// and parse them recursively
			// If the depth is greater than the maximum depth, we will stop
			// and return the response
			//
			// if it is not an index file, we will just return the urls

			const urls = $('loc').map((_, elem) => $(elem).text().trim()).get();

			if (isIndexFile) {
				if (this.#currentDepth >= this.maximumDepth) {
					response.errors.push({
						reason: 'Maximum recursive depth reached, more sites available.',
						url,
					});
					return response;
				}

				this.#currentDepth += 1;

				// Only dispatch maximum 3 promises at a
				// time in the recursive call

				const batches: string[][] = [];

				// TODO: instead of copying memory here
				// we can mutate the original array
				while (urls.length > 0) {
					batches.push(urls.splice(0, 3));
				}

				const sleep = (ms: number) => new Promise(
					(resolve) => setTimeout(resolve, ms)
				);

				for (const batch of batches) {
					const promises = batch.map((loc) =>
						this.#fetcher
							.fetch(loc)
							.then((txt) => this.#parseWithCheerio(
								loc, txt, response
							))
							.catch((error) => {
								response.errors.push({
									reason: error.message,
									url: loc,
								});
								return response;
							})
					);

					await Promise.all(promises);
					await sleep(50);
				}

				// Do not add index file URLS
				return response;
			}

			return urls.reduce<MapSiteResponse>((previous, current) => {
				previous.urls.push(current);
				return previous;
			}, response);
		} catch (error) {
			response.errors.push({
				url,
				reason: error.message,
			});

			return response;
		}
	}

	async #parsePossibleXMLText(
		url: string,
		text: string,
		response: MapSiteResponse = {
			type: 'sitemap',
			urls: [] as string[],
			errors: [] as MapSiteError[],
		}
	): Promise<MapSiteResponse> {
		try {
			const sitemapMatcher = /<(.*:)?sitemap>/gm;
			const isIndexFile = !!text.match(sitemapMatcher);
			response.type = isIndexFile ? 'index' : 'sitemap';

			if (text.length < 1) {
				return response;
			}

			const lines = SitemapParser.getLinesFromText(text);
			const urls = this.#getURLsFromLines(lines);

			if (isIndexFile) {
				if (this.#currentDepth >= this.maximumDepth) {
					response.errors.push({
						reason: 'Maximum recursive depth reached, more sites available.',
						url,
					});
					return response;
				}

				this.#currentDepth += 1;
				const promises = urls.map((loc) =>
					this.#fetcher
						.fetch(loc)
						.then((txt) => this.#parsePossibleXMLText(
							loc, txt, response
						))
						.catch((error) => {
							response.errors.push({
								reason: error.message,
								url: loc,
							});
							return response;
						})
				);

				await Promise.all(promises);
				return response;
			}

			return urls.reduce<MapSiteResponse>((previous, current) => {
				previous.urls.push(current);
				return previous;
			}, response);
		} catch (error) {
			response.errors.push({
				url,
				reason: error.message,
			});

			return response;
		}
	}

	async run(url: string): Promise<MapSiteResponse> {
		try {
			const text = await this.#fetcher.fetch(url);
			return this.#parseWithCheerio(url, text);
		} catch (error) {
			return {
				type: 'sitemap',
				urls: [],
				errors: [
					{
						url,
						reason: error.message,
					},
				],
			};
		}
	}

	async fromBuffer(buffer: Buffer): Promise<MapSiteResponse> {
		try {
			const text = this.#getTextFromBuffer(buffer);
			return this.#parseWithCheerio('buffer', text);
		} catch (error) {
			return {
				type: 'sitemap',
				urls: [],
				errors: [
					{
						url: 'buffer',
						reason: error.message,
					},
				],
			};
		}
	}
}
