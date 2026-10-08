import { parseDocument, type ParsedDocument } from './document';
import type { MapSiteError, SitemapEntry } from './types';

export interface CrawlRoot {
	/** Label used in errors and for de-duplication. */
	url: string;
	load(signal: AbortSignal): Promise<Buffer>;
}

export interface CrawlOptions {
	maximumDepth: number;
	concurrency: number;
	/** Downloads a sitemap referenced by an index. */
	loadChild(url: string, signal: AbortSignal): Promise<Buffer>;
	signal?: AbortSignal;
}

export type CrawlEvent =
	| { kind: 'root'; type: 'sitemap' | 'index' }
	| { kind: 'entry'; entry: SitemapEntry }
	| { kind: 'error'; error: MapSiteError };

interface Task extends CrawlRoot {
	depth: number;
}

type Outcome =
	| { task: Task; document: ParsedDocument }
	| { task: Task; failure: unknown };

const reasonOf = (error: unknown) => error instanceof Error ? error.message : String(error);

const keyOf = (url: string) => URL.canParse(url) ? new URL(url).href : url;

/**
 * Walks sitemap indexes breadth-first, fetching up to `concurrency` documents at
 * a time. Results are yielded in document order (root, then its children in the
 * order listed), so output does not depend on which request finishes first.
 * Documents already seen and pages already yielded are skipped.
 *
 * Stops fetching as soon as the consumer stops iterating or the signal aborts.
 */
export async function* crawl(roots: CrawlRoot[], options: CrawlOptions): AsyncGenerator<CrawlEvent> {
	const stop = new AbortController();
	const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
	const seenDocuments = new Set<string>();
	const seenPages = new Set<string>();
	const queue: Task[] = [];
	const inflight: Promise<Outcome>[] = [];
	let next = 0;

	const enqueue = (root: CrawlRoot, depth: number) => {
		if (seenDocuments.has(keyOf(root.url))) return;
		seenDocuments.add(keyOf(root.url));
		queue.push({ ...root, depth });
	};

	const settle = async (task: Task): Promise<Outcome> => {
		try {
			return { task, document: parseDocument(await task.load(signal)) };
		} catch (failure) {
			return { task, failure };
		}
	};

	try {
		for (const root of roots) enqueue(root, 0);

		while (next < queue.length || inflight.length > 0) {
			while (next < queue.length && inflight.length < options.concurrency) {
				inflight.push(settle(queue[next++]));
			}

			const outcome = await inflight.shift()!;
			signal.throwIfAborted();

			const { task } = outcome;
			const isRoot = task.depth === 0;

			if ('failure' in outcome) {
				if (isRoot) yield { kind: 'root', type: 'sitemap' };
				yield { kind: 'error', error: { url: task.url, reason: reasonOf(outcome.failure) } };
				continue;
			}

			const { document } = outcome;
			if (isRoot) yield { kind: 'root', type: document.type };

			if (document.type === 'sitemap') {
				for (const entry of document.entries) {
					if (seenPages.has(entry.url)) continue;
					seenPages.add(entry.url);
					yield { kind: 'entry', entry };
				}
			} else if (task.depth >= options.maximumDepth) {
				yield {
					kind: 'error',
					error: { url: task.url, reason: 'Maximum recursive depth reached, more sites available.' },
				};
			} else {
				for (const url of document.sitemaps) {
					enqueue({ url, load: childSignal => options.loadChild(url, childSignal) }, task.depth + 1);
				}
			}
		}
	} finally {
		stop.abort();
	}
}
