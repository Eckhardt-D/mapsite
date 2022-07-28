import { z } from "zod";
import { request } from "undici";

type OneToTen = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

interface SitemapFetcherConstructorOptions {
  concurrency: OneToTen;
  maximumRetries: OneToTen;
  maximumDepth: OneToTen;
  debug: boolean;
}

const oneToTenSchema = z.number().int().min(1).max(10);

const constructorOptionsSchema = z
  .object({
    concurrency: oneToTenSchema,
    maximumRetries: oneToTenSchema,
    maximumDepth: oneToTenSchema,
    debug: z.boolean(),
  })
  .required();

export class SitemapFetcher {
  concurrency: OneToTen;
  maximumRetries: OneToTen;
  maximumDepth: OneToTen;
  debug: boolean;

  constructor(options: SitemapFetcherConstructorOptions) {
    const params = constructorOptionsSchema.parse(
      options
    ) as SitemapFetcherConstructorOptions;

    this.concurrency = params.concurrency;
    this.maximumRetries = params.maximumRetries;
    this.maximumDepth = params.maximumDepth;
    this.debug = params.debug;
  }
}
