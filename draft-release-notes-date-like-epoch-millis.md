# Draft Release Notes: Epoch-Millis Support for Date-Like FHIR Primitives

`fumifier` now canonicalizes runtime numeric assignments to FHIR `date`, `dateTime`, and `instant` primitives as UTC epoch-millis values instead of falling back to generic string conversion.

## Highlights

- Numeric inputs for `date`, `dateTime`, and `instant` now go through the date-like canonicalization path instead of being emitted as stringified numbers.
- Valid finite epoch-millis values now produce canonical UTC FHIR output:
  - `date` -> `YYYY-MM-DD`
  - `dateTime` -> `YYYY-MM-DDTHH:mm:ss.SSSZ`
  - `instant` -> `YYYY-MM-DDTHH:mm:ss.SSSZ`
- Invalid numeric values, including non-finite numbers and epoch-millis values outside the supported JavaScript `Date` range, now surface the existing `F5111` validation behavior instead of leaking into output as plain strings.

## User-Visible Corrections

- Assigning `0` to `Patient.birthDate` now yields `1970-01-01`.
- Assigning `0` to `Patient.deceasedDateTime` now yields `1970-01-01T00:00:00.000Z`.
- Assigning `0` to `Observation.issued` now yields `1970-01-01T00:00:00.000Z`.
- Oversized numeric literals that were previously stringified into output are now rejected through `F5111`.

## Notes for Integrators

- This change only affects runtime JavaScript `number` inputs assigned to FHIR `date`, `dateTime`, and `instant` primitives.
- Existing string-based date-like behavior is unchanged, including precision preservation for year-only and year-month inputs.
- No public API signatures changed.

## Validation Summary

- FLASH fixture coverage was added for valid numeric canonicalization and out-of-range `F5111` handling.
- The FLASH-only regression suite passed after rebuild.
- The verbose-policy regression suite passed with the new `F5111` case included.