import { describe, it, expect } from "vitest";
import { SitemapFetcher } from "../src/fetch";

describe("SitemapFetcher.constructor", () => {
  it("accepts valid options", () => {
    const options = {
      concurrency: 3 as const,
      maximumRetries: 3 as const,
      maximumDepth: 3 as const,
      debug: false,
      unknown: "string",
    };

    const fetcher = new SitemapFetcher(options);
    expect(fetcher.concurrency).toBe(options.concurrency);
    expect(fetcher.maximumRetries).toBe(options.maximumRetries);
    expect(fetcher.maximumDepth).toBe(options.maximumDepth);
    expect(fetcher.debug).toBe(options.debug);

    // @ts-ignore:TS2339
    expect(fetcher.unknown).toBeUndefined();
  });
});
