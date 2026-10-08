# Changelog

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
