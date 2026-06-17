# Draft Release Notes: Nested Array Pattern Injection

This release fixes a FLASH evaluation issue affecting profile-driven pattern injection for nested array-typed elements.

## Highlights

- FLASH no longer double-wraps array-valued pattern content when a slice injects a complex value such as `Identifier.type.coding`.
- Profile-driven identifier slices such as `identifier[ppn]` now produce the same flat `coding` structure as equivalent explicit FLASH assignments.
- Explicit child assignments on the same `CodeableConcept` continue to merge normally without reintroducing nested arrays.

## User-Visible Correction

- Fixed cases where evaluating `identifier[ppn].type` could return:

```json
{
  "coding": [
    [
      {
        "code": "PPN",
        "system": "http://terminology.hl7.org/CodeSystem/v2-0203"
      }
    ]
  ]
}
```

- The same expression now returns the correct flat array:

```json
{
  "coding": [
    {
      "code": "PPN",
      "display": "Passport number",
      "system": "http://terminology.hl7.org/CodeSystem/v2-0203"
    }
  ]
}
```

## Compatibility Notes

- No public API changes.
- Existing explicit FLASH assignments for `Identifier.type` and similar structures continue to work unchanged.
- The fix is internal and only removes an incorrect extra array layer from auto-injected pattern values.

## Validation Summary

- Focused `flash-pattern-injection` regression coverage passed, including the issue reproducer, explicit non-slice control, mixed identifier cases, and explicit child-assignment coverage.
- Full Mocha regression suite passed after the fix (`2549 passing, 1 pending`).
