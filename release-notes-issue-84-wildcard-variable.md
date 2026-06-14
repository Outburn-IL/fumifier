# Draft Release Notes: FLASH Wildcard Variable Parsing

This release fixes a FLASH parser issue affecting wildcard variable assignments inside FLASH blocks.

## Highlights

- FLASH now accepts bare wildcard variable assignments such as `$value := *;` in places where FLASH already expects a value expression.
- The unwrapped form now behaves the same as the existing parenthesized workaround `$value := (*);`.
- Existing malformed-rule protections remain in place for empty `*` rules and malformed double-star rules.

## User-Visible Correction

- Fixed cases where `$value := *;` could be rejected as `F1024` (`Malformed FLASH rule: Rule is empty`) even though the equivalent parenthesized form parsed successfully.

## Compatibility Notes

- No public API changes.
- Existing parenthesized expressions continue to work.
- Users who adopted the parenthesized workaround do not need to change existing expressions.

## Validation Summary

- Focused wildcard-hardening regression coverage passed.
- Parser recovery regression coverage passed.