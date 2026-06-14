# Draft Release Notes: Parser and Regex Hardening

This release improves parser recovery, regex handling, and browser-facing token metadata for FLASH/FUME expressions.

## Highlights

- Parser recovery now keeps later division operators as division operators after an earlier syntax error, instead of misreporting them as unterminated regex literals.
- Missing-right-hand-side errors now point directly at the offending operator for cases like `1/`, `(1/)`, and `$var := ;`.
- Browser tokenization now returns stable regex token coordinates and explicit regex flags.
- Exported ASTs now use serializable regex metadata instead of live compiled `RegExp` objects, which improves JSON round-tripping and AST mobility workflows.
- Regex literals are now compiled once per evaluation context and reused within that evaluation, reducing repeated regex setup in per-item flows such as filters.

## User-Visible Corrections

- Fixed misleading `S0302` regex errors that could appear after unrelated earlier syntax errors.
- Added a more actionable missing-RHS diagnostic: `S0218`.
- Stabilized regex node and token coordinates for downstream editor and tooling consumers.

## Notes for Integrators

- Regex entries in exported ASTs and browser token arrays no longer expose live `RegExp` instances.
- Consumers should read regex metadata from `value` and `flags` instead.

## Validation Summary

- Focused parser/browser/AST validation completed successfully.
- Broader Mocha regression coverage completed successfully.