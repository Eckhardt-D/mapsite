import {
	oneToTenSchema,
	SitemapFetcher,
	SitemapFetcherConstructorOptions
} from '.';

import {z} from 'zod';

interface SitemapParserOptions {
  maximumDepth?: number;
}

const sitemapParserConstructorOptionsSchema = z.object({
	maximumDepth: oneToTenSchema.optional(),
	rejectInvalidContentType: z.boolean().optional(),
	maximumRetries: oneToTenSchema.optional(),
	timeout: z.number().optional(),
	debug: z.boolean().optional(),
})
	.default({
		maximumDepth: 2,
		rejectInvalidContentType: true,
		maximumRetries: 3,
		timeout: 3000,
		debug: false,
	});


export type SitemapParserConstructorOptions =
  SitemapFetcherConstructorOptions & SitemapParserOptions;


export interface MapSiteResponse {
  type: 'sitemap' | 'index',
  urls: string[],
  errors: string[],
}

export class SitemapParser {
	#fetcher: SitemapFetcher;
	#currentDepth = 0;
	maximumDepth: number;

	constructor(options?: SitemapParserConstructorOptions) {
		const params = sitemapParserConstructorOptionsSchema
			.parse(options)as SitemapParserConstructorOptions;

		const { maximumDepth, ...rest } = params;

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.maximumDepth = maximumDepth!;
		this.#fetcher = new SitemapFetcher(rest);
	}

	get currentDepth() {
		return this.#currentDepth;
	}

	#getURLsFromLines(lines: string[]): string[] {
		const result = [];
		const locMatcher = /<(.*:)?loc>(.*)<\/(.*:)?loc>/g;

		lines.forEach(line => {
			const matched = line.matchAll(locMatcher);
			const array = [...matched];

			if (!array.length) return;

			const url = array[0][2];

			if (url) {
				result.push(url);
			}
		});

		return result;
	}

	async #parsePossibleXMLText(text: string, response: MapSiteResponse = {
		type: 'sitemap',
		urls: [] as string[],
		errors: [] as string[],
	}): Promise<MapSiteResponse> {
		const sitemapMatcher = /<(.*:)?sitemap>/gm;
		const isIndexFile = !!text.match(sitemapMatcher);
		response.type = isIndexFile ? 'index' : 'sitemap';

		if (text.length < 1) {
			return response;
		}

		const lines = text
			// Make sure <loc>url</loc> has its own line
			.replace(/<(.*:)?loc>/g, '\n<loc>')
			// Make sure <loc>url</loc> has its own line
			.replace(/<\/(.*:)?loc>/g, '</loc>\n')
			// Make sure <sitemap> has its own line
			.replace(/<(.*:)?sitemap>/g, '<sitemap>\n')
			// Make sure <sitemap> has its own line
			.replace(/<\/(.*:)?sitemap>/g, '</sitemap>\n')
			.split('\n');

		const urls = this.#getURLsFromLines(lines);

		if (isIndexFile) {
			if (this.#currentDepth >= this.maximumDepth) {
				response.errors.push('Maximum recursive depth reached, more sites available.');
				return response;
			}

			this.#currentDepth += 1;
			const promises = urls.map(
				url => this.#fetcher.fetch(url)
					.then(txt => this.#parsePossibleXMLText(txt, response))
					.catch(error => {
						response.errors.push(error.message);
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
	}

	async run(url: string): Promise<MapSiteResponse> {
		const text = await this.#fetcher.fetch(url);
		return this.#parsePossibleXMLText(text);
	}
}