# mapsite

Fetch and parse the URLs of a sitemap: XML sitemaps, sitemap indexes (followed recursively), gzipped sitemaps, plain-text sitemaps and RSS/Atom feeds, from a URL, a buffer, or a site's `robots.txt`.

> [!NOTE]
> This is the 3.x documentation. Still on 2.x? It remains maintained on the [`v2` branch](https://github.com/Eckhardt-D/mapsite/tree/v2) with bug and security fixes. See [Upgrading from 2.x](#upgrading-from-2x) for what changed.

Requires Node.js 22.19.0 or newer. Ships ESM and CommonJS builds with TypeScript types.

```bash
npm install mapsite
```

## Usage

```js
import { SitemapParser } from "mapsite"; // or: const { SitemapParser } = require("mapsite");

const parser = new SitemapParser();
const result = await parser.run("https://example.com/sitemap.xml");

console.log(result.urls); // ["https://example.com/", "https://example.com/about", …]
console.log(result.errors); // sitemaps that could not be fetched or parsed

await parser.close(); // releases pooled connections
```

`run` never throws for a bad sitemap. A sitemap that cannot be fetched or parsed is reported in `errors` while everything else is still returned. The parser also supports `await using parser = new SitemapParser()`.

### Result

```ts
{
  type: "sitemap" | "index", // "index" when the root document is a sitemap index
  urls: string[],            // every page found, in document order, without duplicates
  entries: SitemapEntry[],   // the same pages with their details (see below)
  errors: { url: string; reason: string }[],
}
```

Each entry has a `url` and, when the sitemap provides them, `lastmod`, `changefreq`, `priority` (a number) and `alternates` (`{ href, hreflang? }[]` from `xhtml:link` tags). Values are reported as written.

## Methods

### `run(url, { signal? })`

Fetches a sitemap or sitemap index and every sitemap it links to, up to `maximumDepth` levels.

### `fromBuffer(buffer, { signal? })`

Parses a sitemap you already have, for example an uploaded file. Gzipped buffers are inflated. If the buffer is an index, the sitemaps it links to are fetched. Errors about the buffer itself use the url `"buffer"`.

```js
const result = await parser.fromBuffer(await readFile("./sitemap.xml"));
```

### `discover(site, { signal? })`

Finds a site's sitemaps from the `Sitemap:` lines of its `/robots.txt`, falls back to `/sitemap.xml`, and crawls all of them. Pass any URL on the site. When several sitemaps are found, `type` is `"index"`.

```js
const result = await parser.discover("https://example.com");
```

### `stream(url, { signal?, onError? })`

An async iterator that yields entries as soon as they are found, without holding every URL in memory. Breaking out of the loop cancels the requests still in flight. Failed documents are passed to `onError` instead of being yielded.

```js
for await (const entry of parser.stream("https://example.com/sitemap.xml", {
  onError: (error) => console.warn(error.url, error.reason),
})) {
  if (entry.url.includes("/blog/")) break;
}
```

### Cancelling

Every method accepts an `AbortSignal`. Aborting cancels pending requests and rejects with the signal's reason; that is the only case where these methods reject.

```js
const result = await parser.run(url, { signal: AbortSignal.timeout(30_000) });
```

### `close()`

Closes the parser's connections. Safe to call more than once.

## Options

All options are optional. Invalid values throw a `TypeError` naming the option; unknown options are ignored.

| Option | Default | Description |
| --- | --- | --- |
| `rejectInvalidContentType` | `true` | Only accept `text/xml`, `application/xml`, `application/rss+xml`, `application/atom+xml`, `text/plain` and gzip responses (`application/gzip`, `application/x-gzip`, `application/zip`). `application/octet-stream` is accepted only when the body is gzip. A missing `Content-Type` is rejected. |
| `userAgent` | A recent Chrome user agent | Sent as the `User-Agent` header. |
| `maximumRetries` | `1` | Extra attempts after a transient failure, `0` to `10`. Only network errors, timeouts and the statuses 408, 425, 429 and 5xx are retried, with exponential backoff. Other 4xx statuses fail immediately. |
| `retryDelay` | `250` | Base backoff in milliseconds; each retry waits roughly twice as long as the last, up to 10 seconds. |
| `maximumDepth` | `2` | How many levels of sitemap indexes to follow, `1` to `10`. An index found beyond that is reported in `errors` and not followed. |
| `concurrency` | `3` | Sitemaps fetched at the same time per call, `1` to `20`. |
| `timeout` | `3000` | Milliseconds a request may wait for response headers, and for more body data once it has started. Not a limit on the whole download. Enforced on a coarse timer, so expect about half a second of slack. |
| `maximumResponseSize` | `52428800` (50 MiB) | Largest accepted document in bytes, checked while downloading and again after decompression. Larger responses are rejected. |
| `proxy` | none | URL of an HTTP(S) proxy, e.g. `https://user:pass@proxy.host:3000`. As in 2.x, TLS certificates are not verified on the proxy connection. |

## How it behaves

- **Formats are detected from the content,** not the `Content-Type`: XML sitemaps, sitemap indexes, RSS, Atom, and plain text (one URL per line). Gzip is detected from the data. Element prefixes (`ns1:loc`) are handled; image and video locations are not reported as pages. Malformed XML is tolerated and whatever can be read is returned.
- **Redirects are followed** (up to 5). Credentials are not forwarded to a different origin.
- **Credentials in the URL** (`https://user:pass@host/sitemap.xml`) are sent as Basic Auth, and removed from the request URL.
- **Order and duplicates:** pages come back in document order, whichever request finishes first. A sitemap linked twice (or an index linking to itself) is fetched once, and a page listed in several sitemaps is reported once.
- **Only `http:` and `https:`** URLs are fetched.

## Upgrading from 2.x

The constructor, option names, `run`, `fromBuffer` and the `{ type, urls, errors }` result are unchanged. What differs:

- `type` is the type of the **root** document. A sitemap index now reports `"index"`; 2.x reported whichever document finished last.
- Removed: the `debug` option (it did nothing), `SitemapParser.getLinesFromText`, and the `currentDepth` and `maximumDepth` properties. `currentRetry` no longer exists either; those values were meaningless with concurrent use.
- `maximumRetries` is `1` by default, whether or not you pass other options (2.x used `3` only when no options object was passed), and may now be `0`. Retries are limited to transient failures.
- Content types are matched exactly (a `text/xml; charset=utf-8` header is fine; a header that merely contains `text/xml` is not).
- Invalid options throw `TypeError` instead of a `ZodError`.
- Pages and sitemaps seen more than once are skipped.
- Results gain `entries`; documents larger than 50 MiB are rejected unless you raise `maximumResponseSize`.
- Parsing no longer goes through Cheerio's HTML parser. `<loc>` is read only as a child of `<url>` or `<sitemap>`.
- Dependencies: `cheerio` and `zod` are replaced by `htmlparser2`.

## Development

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run compile
```

Tests start local HTTP servers and never request external websites.

## Releasing

From a clean, up-to-date `v3` (or `master` once v3 is merged) with the changelog entry committed:

```bash
npm run release -- prerelease --preid beta  # 3.0.0-beta.N, published under the `next` tag
npm run release -- patch                    # stable, published under `latest`
npm run release -- minor --dry-run          # run the checks and `npm pack --dry-run` only
```

2.x releases are made from the `v2` branch with its own script.
