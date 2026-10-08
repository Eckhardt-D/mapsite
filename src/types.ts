export interface SitemapAlternate {
	href: string;
	hreflang?: string;
}

/**
 * One page listed by a sitemap. Optional fields are only present when the
 * sitemap provides them; values are reported as written, not normalised.
 */
export interface SitemapEntry {
	url: string;
	lastmod?: string;
	changefreq?: string;
	priority?: number;
	alternates?: SitemapAlternate[];
}

export interface MapSiteError {
	url: string;
	reason: string;
}

export interface MapSiteResponse {
	/** `index` when the root document (or any root, for `discover`) is a sitemap index. */
	type: 'sitemap' | 'index';
	urls: string[];
	/** Only present when the `includeEntries` option is on. */
	entries?: SitemapEntry[];
	errors: MapSiteError[];
}

export interface RequestOptions {
	/** Abort the crawl. Pending requests are cancelled and the call rejects with the signal's reason. */
	signal?: AbortSignal;
}

export interface StreamOptions extends RequestOptions {
	/** Called for every document that could not be fetched or parsed. */
	onError?: (error: MapSiteError) => void;
}
