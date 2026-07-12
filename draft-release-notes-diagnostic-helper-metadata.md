# Draft Release Notes: Diagnostic Helper Metadata

`fumifier` now preserves stable execution IDs and helper source-location metadata in verbose diagnostics emitted by `$warn`, `$info`, and `$trace`.

This fixes cases where helper-generated diagnostic entries could show `executionId: 'unknown'`, especially when the helper ran from a derived frame such as a nested function call or block scope.

Verbose helper diagnostics now also include the helper call-site `position`, `start`, and `line` fields again, making it easier to trace warnings and debug entries back to the expression source that emitted them.

This is a bug-fix level change. Helper diagnostic codes, buckets, messages, log behavior, and `$trace` return semantics are unchanged.