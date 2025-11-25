// Profile for testing dual assignment scenarios
// Tests multiple rules assigning grandchildren to the same child:
// * identifier.system = "value"
// * identifier.value = "value"
// vs nested assignment:
// * identifier
//   * system = "value"
//   * value = "value"

Profile: DualAssignmentTestProfile
Parent: Patient
Id: dual-assignment-test-profile
Title: "Dual Assignment Test Profile"
Description: "A test profile for validating dual assignment behavior with sliced identifiers"

// Set up slicing on identifier with max=1 constraint
* identifier ^slicing.discriminator.type = #value
* identifier ^slicing.discriminator.path = "system"
* identifier ^slicing.rules = #open

// Create a max=1 slice with system discriminator
* identifier contains TestSlice 0..1
* identifier[TestSlice].system = "http://example.org/dual-assignment-test" (exactly)
* identifier[TestSlice].value 1..1 MS

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