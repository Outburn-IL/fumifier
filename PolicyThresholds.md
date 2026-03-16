# Policy thresholds and createPolicy API

Fumifier uses policy thresholds to decide when to validate, log, collect diagnostics and throw. Severities are numeric bands (lower = more critical):

- fatal: 0
- invalid: 10
- error: 20
- warning: 30
- notice: 40
- info: 50
- debug: 60

Thresholds are exclusive comparisons (sev < threshold) and are provided via the evaluation environment:

- throwLevel: throw when severity < throwLevel (default 30)
- logLevel: log when severity < logLevel (default 40)
- collectLevel: collect diagnostic when severity < collectLevel (default 70)
- validationLevel: run validations when severity < validationLevel (default 30)

What `logLevel` means:
- It gates whether a diagnostic is emitted to the *evaluation environment logger* (`Symbol.for('fumifier.__logger')`).
- That logger is typically provided by the embedding application via `compiled.setLogger(...)` or per-evaluation via `runtimeOptions.logger`.
- This is distinct from any global application log filtering (e.g. a conventional `LOG_LEVEL` env var): `logLevel` controls fumifier policy logging decisions, not the host application's logger configuration.

A centralized policy helper simplifies decision-making:

- File: `src/utils/policy.js`
- API: `createPolicy(env)` returns:
  - `shouldValidate(code: string): boolean` — true if the validation for this code should run (not inhibited by validationLevel).
  - `enforce(err: { code: string, ... }): boolean` — populates message, applies thresholds, logs when `sev < logLevel`, collects when `sev < collectLevel`, and returns true only when `sev < throwLevel`.

Important:
- `validationLevel` is used to decide whether to run a check at all. When a check is inhibited (`sev >= validationLevel`), call sites should skip doing the work and usually will not call `enforce`, so nothing is logged or collected.
- If `enforce` is called while inhibited, it will not log or throw and will safely return `false`.

Example usage in a validation site:

```js
import createPolicy from './utils/policy.js';

function validateSomething(expr, env, value) {
  const policy = createPolicy(env);
  // Skip work entirely when validation is inhibited for this code
  if (!policy.shouldValidate('F5110')) {
    return value; // inhibited: do not attempt regex/convert
  }

  // Perform the check and report if it fails
  const ok = /someRegex/.test(String(value));
  if (!ok) {
    const err = { code: 'F5110', fhirElement: 'Resource.id', value };
    if (policy.enforce(err)) {
      throw err; // only when thresholds say throw (sev < throwLevel)
    }
    // downgraded: continue with value
  }
  return value;
}
```

Notes:
- `validationLevel` prevents running costly validations when their severity is not in scope. Inhibited validations typically do no work and produce no diagnostics.
- Verbose evaluation (`evaluateVerbose`) never throws; it returns `{ ok, status, result, diagnostics }` where status is derived from collected diagnostics and `throwLevel`.
- You can override thresholds per invocation by passing bindings: `{ throwLevel, logLevel, collectLevel, validationLevel }`.