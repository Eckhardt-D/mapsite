import { Parser } from 'htmlparser2';
import type { SitemapEntry } from './types';

export type ParsedDocument =
	| { type: 'index'; sitemaps: string[] }
	| { type: 'sitemap'; entries: SitemapEntry[] };

type Format = 'index' | 'urlset' | 'rss' | 'atom';
type Field = 'url' | 'lastmod' | 'changefreq' | 'priority';

// Element that wraps one item, per format.
const ITEM: Record<Format, string> = { index: 'sitemap', urlset: 'url', rss: 'item', atom: 'entry' };

// Child element -> entry field, per format. Atom's <link> carries its URL in `href`.
const FIELDS: Record<Format, Record<string, Field>> = {
	index: { loc: 'url' },
	urlset: { loc: 'url', lastmod: 'lastmod', changefreq: 'changefreq', priority: 'priority' },
	rss: { link: 'url', pubdate: 'lastmod' },
	atom: { updated: 'lastmod' },
};

function formatOf(root: string): Format {
	if (root === 'sitemapindex') return 'index';
	if (root === 'rss') return 'rss';
	if (root === 'feed') return 'atom';
	return 'urlset';
}

// "image:loc" -> "loc". Sitemaps in the wild use arbitrary namespace prefixes.
const localName = (name: string) => name.slice(name.lastIndexOf(':') + 1).toLowerCase();

/**
 * Reads a sitemap, sitemap index, RSS/Atom feed or plain-text sitemap. The
 * format is detected from the content, not from the Content-Type header.
 * Malformed XML is tolerated: whatever can be recognised is returned.
 */
export function parseDocument(bytes: Buffer): ParsedDocument {
	const text = bytes.toString('utf8').replace(/^﻿/, '');
	if (text.trimStart().startsWith('<')) return parseXml(text);
	return { type: 'sitemap', entries: parseText(text) };
}

function parseText(text: string): SitemapEntry[] {
	return text
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => /^https?:\/\//i.test(line))
		.map(url => ({ url }));
}

function parseXml(text: string): ParsedDocument {
	const sitemaps: string[] = [];
	const entries: SitemapEntry[] = [];
	const path: string[] = [];
	let format: Format | undefined;
	let draft: Partial<SitemapEntry> | undefined;
	let field: Field | undefined;
	let fieldTag = '';
	let content = '';

	const parser = new Parser({
		onopentag(rawName, attributes) {
			const tag = localName(rawName);
			const parent = path[path.length - 1];
			path.push(tag);
			format ??= formatOf(tag);

			if (draft === undefined) {
				if (tag === ITEM[format] && path.length > 1) draft = {};
				return;
			}
			if (parent !== ITEM[format]) return;

			if (tag === 'link' && format === 'urlset' && attributes.rel === 'alternate' && attributes.href) {
				(draft.alternates ??= []).push({
					href: attributes.href,
					...(attributes.hreflang ? { hreflang: attributes.hreflang } : {}),
				});
			} else if (tag === 'link' && format === 'atom') {
				if ((attributes.rel ?? 'alternate') === 'alternate' && attributes.href) draft.url ??= attributes.href;
			} else if (tag in FIELDS[format]) {
				field = FIELDS[format][tag];
				fieldTag = tag;
				content = '';
			}
		},
		ontext(data) {
			if (field !== undefined) content += data;
		},
		onclosetag(rawName) {
			const tag = localName(rawName);
			path.pop();
			if (format === undefined || draft === undefined) return;

			if (field !== undefined && tag === fieldTag) {
				assign(draft, field, content.trim());
				field = undefined;
			} else if (tag === ITEM[format]) {
				if (draft.url) {
					if (format === 'index') sitemaps.push(draft.url);
					else entries.push(draft as SitemapEntry);
				}
				draft = undefined;
			}
		},
	}, { xmlMode: true });

	parser.write(text);
	parser.end();

	return format === 'index' ? { type: 'index', sitemaps } : { type: 'sitemap', entries };
}

function assign(draft: Partial<SitemapEntry>, field: Field, value: string) {
	if (value === '') return;
	if (field === 'priority') {
		const priority = Number(value);
		if (Number.isFinite(priority)) draft.priority = priority;
	} else {
		draft[field] ??= value;
	}
}
