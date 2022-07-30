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

	async #parsePossibleXMLText(text: string): Promise<MapSiteResponse> {
		const locMatcher = /<(.*:)?loc>(.*)<\/(.*:)?loc>/g;
		const sitemapMatcher = /<(.*:)?sitemap>/gm;
		const isIndexFile = !!text.match(sitemapMatcher);


		const response: MapSiteResponse = {
			type: 'sitemap',
			urls: [] as string[],
			errors: [] as string[],
		};

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

		for (const line of lines) {
			const extraction = line.matchAll(locMatcher);
			const arr = [...extraction];

			if (arr.length > 0) {
				const location = arr[0][2];

				if (location) {
					if (isIndexFile) {
						if (this.#currentDepth < this.maximumDepth) {
							this.#currentDepth += 1;
							const text = await this.#fetcher.fetch(location);
							return this.#parsePossibleXMLText(text);
						} else {
							response.errors.push('Error');
							response.type = 'index';
							return response;
						}
					}
					response.urls.push(arr[0][2]);
				}
			}
		}

		return response;
	}

	async run(url: string): Promise<MapSiteResponse> {
		const text = await this.#fetcher.fetch(url);
		return this.#parsePossibleXMLText(text);
	}
}