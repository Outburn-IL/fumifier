# Draft Release Notes: HOF Issues 86, 87, 88, 96, 97

`fumifier` now adds four public higher-order functions: `$safe`, `$all`, `$any`, and `$memoize`.

These additions let expressions wrap failure-prone helpers without throwing, evaluate collection predicates with sequential sync/async short-circuiting, and reuse repeated results within a single evaluation.

`$search(..., { fetchAll: true, transform })` now also works from the public expression surface when `transform` is defined as an inline `fumifier` function, not just as a native JavaScript callback.

Highlights:

- `$safe()` returns structured success/error result objects with sanitized public error fields.
- `$all()` and `$any()` support sync and async predicates and preserve deterministic short-circuit order.
- `$memoize()` caches fulfilled results for one evaluation, shares in-flight async work for duplicate calls, and drops failed entries so later retries can re-run.
- Wrapped mapping parse failures now preserve informative parser messages instead of degrading to `[object Object]`.

Compatibility notes:

- `$memoize()` rejects function-valued and symbol-valued argument trees.
- `$search` transform follows the `@outburn/fhir-client` contract and is only valid with `fetchAll: true`.
- `maxResults` still applies to raw fetched resources before transform filtering.