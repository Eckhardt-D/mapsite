> Note: Version 2 of this package may differ in results from version 1.x. Mainly because the parser is now using Cheerio

# Getting Started

```bash
npm install mapsite
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

`default: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36 mapsite/1.0`

---

`maximumRetries`: number;

How many times a url in the `<loc>` tag of an XML index file should be requested when response status is not < 400.

`default: 1`

---

`maximumDepth`: string;

How many levels deep should XML index files be traversed. E.g. if index files are nested 3 levels and maximum depth is 2. The last response will not crawl the URLs in the `<loc>` tag further.

`default: 2`

---

`timeout`: number;

The number of milliseconds allowed for a request to complete, both headers or body will timeout at this point.

`default: 300`

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
