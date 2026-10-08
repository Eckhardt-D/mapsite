/** Returns the absolute http(s) URLs of every `Sitemap:` line in a robots.txt. */
export function parseRobots(text: string, base: URL): string[] {
	const sitemaps = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
		if (match === null || !URL.canParse(match[1], base.href)) continue;
		const url = new URL(match[1], base);
		if (url.protocol === 'http:' || url.protocol === 'https:') sitemaps.add(url.href);
	}
	return [...sitemaps];
}
