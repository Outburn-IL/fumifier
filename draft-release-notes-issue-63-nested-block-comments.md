# Draft Release Notes: Issue 63 Nested Block Comments

`fumifier` now skips nested `/* ... */` block comments correctly, so inner comment markers no longer cause the outer comment body to leak into live expression parsing.

This fixes cases where expressions with nested block comments could produce misleading parser or evaluator errors because trailing comment text was being tokenized as real code. Expressions that continue normally after the comment now evaluate normally, and expressions that are still invalid after comment removal now surface the real parser error instead.

This is a bug-fix level change. Public APIs and expression semantics are unchanged outside of corrected comment handling, and unterminated block comments continue to report the existing `S0106` error.