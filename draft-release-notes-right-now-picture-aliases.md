# Draft Release Notes: Picture Aliases and Formatted `$rightNow()`

`fumifier` now lets `$rightNow()` format the current wall-clock time using the same picture pipeline as `$now()` and `$fromMillis()`, and adds a small set of exact picture aliases for formatting-oriented date/time helpers.

## Highlights

- `$rightNow()` remains backward-compatible with its existing zero-argument behavior and still returns epoch milliseconds when called without arguments.
- `$rightNow(picture)` and `$rightNow(picture, timezone)` now return formatted strings instead of requiring callers to compose formatting separately.
- `$now()` and `$fromMillis()` now accept the same exact picture aliases:
  - `date` -> `YYYY-MM-DD`
  - `dateTime` -> second-precision timestamp with timezone
  - `instant` -> millisecond-precision timestamp with timezone
  - `time` -> `HH:MM:SS.sss`

## User-Visible Changes

- `$rightNow('date')` now returns a calendar date such as `2026-07-14`.
- `$rightNow('instant')` now returns a full timestamp such as `2026-07-14T12:34:56.789Z`.
- `$fromMillis(0, 'dateTime')` now returns `1970-01-01T00:00:00Z`.
- `$fromMillis(0, 'dateTime', '-0500')` now returns `1969-12-31T19:00:00-05:00`.

## Notes for Integrators

- Alias matching is exact and case-sensitive. Only the known keywords are rewritten.
- Existing raw picture strings are unchanged and still go through the same formatter behavior as before.
- Alias handling is formatting-only in this change. `$toMillis()` parsing behavior is unchanged.
- Timezone handling is unchanged; aliases honor the optional timezone argument in the same way as raw pictures.

## Validation Summary

- Added focused implementation coverage for `$rightNow()`, `$now()`, and `$fromMillis()` alias behavior.
- Rebuilt the package outputs and ran the focused implementation suite.
- `npx mocha test/implementation-tests.test.js --timeout=20000` passed with `79 passing`.