# Changelog

## 3.0.0 (unreleased)

The constructor, option names, `run`, `fromBuffer` and the `{ type, urls, errors }`
result are unchanged. The internals were rewritten; see "Upgrading from 2.x" in the
README for the full list of differences.

### Breaking

- `type` reports the root document: a sitemap index is `"index"` (2.x returned
  whichever document finished last).
- Removed the `debug` option, `SitemapParser.getLinesFromText`, and the
  `currentDepth`, `currentRetry` and `maximumDepth` properties.
- `maximumRetries` defaults to `1` regardless of other options (2.x used `3` only
  without an options object) and accepts `0`. Only transient failures are retried,
  with exponential backoff; 4xx responses other than 408, 425 and 429 are not.
- Content types are matched exactly instead of by substring.
- Invalid options throw a `TypeError` naming the option instead of a `ZodError`.
- Pages and sitemaps seen more than once are skipped; pages come back in document
  order.
- Documents over 50 MiB (compressed or decompressed) are rejected; see
  `maximumResponseSize`.
- `<loc>` is read only as a child of `<url>` or `<sitemap>`.

### Added

- `entries` on the result: `lastmod`, `changefreq`, `priority` and hreflang
  `alternates` next to each URL.
- `discover(site)` finds sitemaps through `robots.txt` (falling back to
  `/sitemap.xml`).
- `stream(url)` yields entries as they are found, and stops fetching when you stop
  iterating.
- `AbortSignal` support on every method, and `close()` / `await using`.
- Plain-text sitemaps, RSS and Atom feeds.
- Redirects are followed, and gzip is detected from the data rather than the
  content type.
- Options `concurrency`, `maximumResponseSize` and `retryDelay`.
- ESM and CommonJS builds with an `exports` map.

### Changed

- Rewrote the crawler and HTTP layer; sitemaps are fetched concurrently without the
  fixed three-at-a-time batches and delays.
- Parsing uses `htmlparser2` instead of Cheerio and regular expressions;
  `cheerio` and `zod` are no longer dependencies.
- Tests exercise the public API against local servers; strict TypeScript.

## 2.2.1

- Declare Node.js 22.19.0 as the minimum supported runtime.
- Update runtime and development dependencies, remove unused dependencies, and
  commit the npm lockfile for reproducible development and CI.
- Fix TypeScript declaration generation with current Cheerio types while keeping
  the existing parsing mode and response shape.
- Give each fetch its own retry budget, including concurrent requests.
- Apply HTTP status handling and retries to authenticated requests; correctly
  decode URL credentials and support empty passwords.
- Accept missing content-type headers when strict checking is disabled and drain
  rejected response bodies.
- Apply the documented default recursion limit with partial constructor options,
  count depth per branch, and reset the depth counter for each parse operation.
- Replace fixed test ports and shared test state with independent local fixtures;
  cover nested indexes, repeated calls, concurrency, authentication, and proxies.
- Make coverage optional for local tests and check the build across Node 22, 24,
  and 26 in CI. Rebuild distributable files before packing or publishing.

Public methods, option names, exports, and response shapes are unchanged.
