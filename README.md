> Note: Version 2 of this package may differ in results from version 1.x. Mainly because the parser is now using Cheerio

# Getting Started

Requires Node.js 22.19.0 or newer.

```bash
npm install mapsite@2
```

or

```bash
yarn add mapsite
```

# Usage

```js
const { SitemapParser } = require("mapsite");

const options = {
  rejectInvalidContentType: true,
  userAgent: "customUA",
  maximumRetries: 1,
  maximumDepth: 5,
  timeout: 3000,
  debug: false,
};

const parser = new SitemapParser(options);
```

### With proxy

```js
const { SitemapParser } = require("mapsite");

const parser = new SitemapParser({
  proxy: 'https://username:password@proxy.host:3000'
});
```

## options

All options are optional, with default fallbacks encoded.

`rejectInvalidContentType`: boolean;

Checks that the response content-type header MUST be:

- `application/xml`
- `application/rss+xml`
- `text/xml`

`default: true`

---

`userAgent`: string;

Adds a custom `User-Agent` string to the requests.

`default: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36`

---

`maximumRetries`: number;

How many times a url in the `<loc>` tag of an XML index file should be requested when response status is not < 400.

`default: 3` when no options object is supplied; `1` when an options object omits this field.

---

`maximumDepth`: number;

How many levels deep should XML index files be traversed. E.g. if index files are nested 3 levels and maximum depth is 2. The last response will not crawl the URLs in the `<loc>` tag further.

`default: 2`

---

`timeout`: number;

The number of milliseconds allowed for a request to complete, both headers or body will timeout at this point.

`default: 3000`

---

`debug`: boolean;

Logs info, warning and error messages as the parser runs (WIP).

`default: false`

---

---

`proxy`: string;

A URL of a proxy server to proxy the request through.

---

## Methods

### run

```js
const parser = new SitemapParser();
const result = await parser.run("https://example.com/sitemap.xml");
```

`result`: MapsiteResponse;

The result shape looks as follows:

```js
const result = {
  type: "sitemap",
  urls: ["https://example.com"],
  errors: [
    {
      url: "https://example.com/sitemap-index.xml",
      reason: "Brief description of what went wrong",
    },
  ],
};
```

### fromBuffer

```js
const { readFileSync } = require("fs");
const parser = new SitemapParser();
const buffer = Buffer.from(readFileSync("./sitemap.xml")); // Or a buffer from an uploaded file
const result = await parser.fromBuffer(buffer);
```

`result`: MapsiteResponse;

The result shape looks as follows:

```js
const result = {
  type: "sitemap", // or 'index'
  urls: ["https://example.com"],
  errors: [
    {
      url: "buffer",
      reason: "Brief description of what went wrong",
    },
  ],
};
```

## Development

```bash
npm ci
npm test
npm run test:coverage
npm run lint
npm run typecheck
npm run compile
```

Tests use local HTTP fixtures and do not request external websites. Coverage is
optional for local runs. `npm pack` and `npm publish` rebuild the CommonJS entry
and TypeScript declarations automatically.

## Releasing (2.x maintenance line)

Version 2 is maintained on the `v2` branch: bug fixes and security fixes only,
no breaking changes. Open PRs against `v2`, add a `CHANGELOG.md` entry, then from
a clean, up-to-date `v2` checkout:

```bash
npm run release -- patch            # or: minor
npm run release -- patch --dry-run  # run the checks and `npm pack --dry-run`
```

The script runs lint, typecheck, and tests, bumps the version (commit and tag),
publishes, and pushes the branch and tag. It publishes under the `latest`
dist-tag while 2.x is the newest major, and under `v2` once a newer major owns
`latest`, so a 2.x patch never replaces the current release.
