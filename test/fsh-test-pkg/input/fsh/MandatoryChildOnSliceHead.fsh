// Profile for testing mandatory child on slice head scenarios.
// For example, if identifier has system mandatory on all slices,
// When creating a slice entry with the system, we shall not throw.
// This profile and related tests are meant to ensure we don't accidentally throw for the head slice constraints when a slice satisfies them.
Profile: MandatoryChildOnSliceHead
Parent: Patient
Title: "Mandatory Child On Slice Head Profile"
Description: "A test profile for validating mandatory child behavior with sliced identifiers"

// make identifier mandatory, to trigger an auto-value on head slice
* identifier 1..

// make system and value mandatory on all slices
* identifier.system 1..
* identifier.value 1..

// Set up slicing on identifier
* identifier ^slicing.discriminator.type = #value
* identifier ^slicing.discriminator.path = "system"
* identifier ^slicing.rules = #open

// Create a max=1 slice with system discriminator
* identifier contains TestSlice 0..1
* identifier[TestSlice].system = "http://example.org/dual-assignment-test" (exactly)

// Constrain contact for deeper level dual assignment testing:
// * contact.name.family = "Doe"
// * contact.name.given = "John"
// vs nested assignment:
// * contact.name
//   * family = "Doe"
//   * given = "John"
// and:
// * contact
//   * name.family = "Doe" (exactly)
//   * name.given = "John" (exactly)

* contact ..1