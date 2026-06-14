# Draft Release Notes: Issue 89 HTTP Error Redaction

`fumifier` now prevents raw nested HTTP/client errors from being serialized into verbose diagnostics and wrapped FHIR-related runtime errors.

This improves security and privacy behavior by removing accidental exposure of auth config, authorization headers, and other nested request details while preserving safe diagnostic fields such as error code, message, HTTP status, and safe request metadata when available.

This is a bug-fix level change for the package. The public verbose contract was already intended to surface sanitized diagnostics rather than raw client internals.

Consumers that were reading serialized `sourceError` payloads should switch to the stable safe fields exposed on diagnostics and wrapped errors (`code`, `message`, `sourceMessage`, `status`, `request`, and `operationOutcome` where present).