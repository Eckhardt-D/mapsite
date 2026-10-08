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
		maximumDepth: oneToTenSchema.default(2),
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
		);

		const { maximumDepth, ...rest } = params;

		this.maximumDepth = maximumDepth;
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

	async #parseWithCheerio(
		url: string,
		text: string,
		response: MapSiteResponse = {
			type: 'sitemap',
			urls: [],
			errors: [],
		},
		depth = 0
	): Promise<MapSiteResponse> {
		try {
			// First convert all namespaced :loc to loc
			// This is because cheerio does not support namespaced tags
			// ignore media namespaced items
			text = text.replace(/<((?!(image|video))[A-z0-9]+):loc>/g, '<loc>');
			text = text.replace(/<\/((?!(image|video))[A-z0-9]+):loc>/g, '</loc>');

			const $ = loadHTML(text);

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
				if (depth >= this.maximumDepth) {
					response.errors.push({
						reason: 'Maximum recursive depth reached, more sites available.',
						url,
					});
					return response;
				}

				this.#currentDepth = Math.max(this.#currentDepth, depth + 1);

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
								loc, txt, response, depth + 1
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

	async run(url: string): Promise<MapSiteResponse> {
		this.#currentDepth = 0;
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
		this.#currentDepth = 0;
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
