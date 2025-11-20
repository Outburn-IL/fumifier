Profile: DecorativeFixedValueTest
Parent: Observation
Id: DecorativeFixedValueTest
Title: "Decorative Fixed Value Test Profile"
Description: "Test profile for decorative fixed value injection feature covering Coding.display, CodeableConcept.text, and Quantity.unit"

// Test case 1: Coding.display - should be injected when system and code are mandatory and injected
* category 1..1
* category.coding ^slicing.discriminator[0].type = #value
* category.coding ^slicing.discriminator[0].path = "system"
* category.coding ^slicing.discriminator[1].type = #value
* category.coding ^slicing.discriminator[1].path = "code"
* category.coding ^slicing.rules = #open
* category.coding contains DecorativeCodingSlice 1..1
* category.coding[DecorativeCodingSlice].system 1..1
* category.coding[DecorativeCodingSlice].system = "http://terminology.hl7.org/CodeSystem/observation-category" (exactly)
* category.coding[DecorativeCodingSlice].code 1..1
* category.coding[DecorativeCodingSlice].code = #vital-signs (exactly)
* category.coding[DecorativeCodingSlice].display = "Vital Signs" (exactly) // This should be injected (decorative, optional with fixed value)

// Test case 2: CodeableConcept.text - should be injected when parent is created
* code 1..1
* code.coding ^slicing.discriminator[0].type = #value
* code.coding ^slicing.discriminator[0].path = "system"
* code.coding ^slicing.discriminator[1].type = #value
* code.coding ^slicing.discriminator[1].path = "code"
* code.coding ^slicing.rules = #open
* code.coding contains CodeSlice 1..1
* code.coding[CodeSlice].system 1..1
* code.coding[CodeSlice].system = "http://loinc.org" (exactly)
* code.coding[CodeSlice].code 1..1
* code.coding[CodeSlice].code = #8302-2 (exactly)
* code.text = "Body height" (exactly) // This should be injected (decorative, optional with fixed value)

// Test case 3: Quantity.unit - should be injected when value is mandatory
* value[x] only Quantity // narrow down to Quantity
* valueQuantity 0..1 // Optional parent
* valueQuantity.value 1..1 // Mandatory value
* valueQuantity.unit = "cm" (exactly) // This should be injected (decorative, optional with fixed value)
* valueQuantity.system 1..1
* valueQuantity.system = "http://unitsofmeasure.org" (exactly)
* valueQuantity.code 1..1
* valueQuantity.code = #cm (exactly)

// Additional mandatory elements to make instances valid
* status = #final (exactly)
* subject 1..1