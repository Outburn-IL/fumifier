# Draft Release Notes: Function Error Spans

`fumifier` now preserves the full function call-head span for runtime function-validation diagnostics, including both contextual signature failures and direct argument-type validation failures.

This fixes cases where function-call errors such as `T0411` and `T0410` could report `start` at the opening parenthesis instead of the function name, or drop `start: 0` entirely when the call began at the start of an expression.

Verbose diagnostics for function invocation now consistently anchor to the callee span, making it easier to highlight and trace invalid calls such as `$search(...)` and other registered helper or user-defined function invocations.

This is a bug-fix level change. Error codes, signature validation behavior, and function execution semantics are unchanged; only the reported source metadata for these diagnostics has been corrected.