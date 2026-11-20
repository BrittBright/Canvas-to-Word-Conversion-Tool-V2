# Version 1.3.1 validation

Tested against the instructor-provided QTI 1.2 export: 100 items consisting of 77 multiple choice, 12 multiple answer, one ordering, five numerical, four categorization, and one matching question. All 11 previously unsupported items are recognized without a fallback warning in this sample.

Checks cover:

- Complete ordering sequences and numerical values from the source scoring conditions.
- Category assignments identified by response ID, including the 1/2/2 clinical task and unused distractors. Repeated option lists are deduplicated for paper output.
- Matching prompts, shared answer choices, and preserved pairs.
- Negated conditions excluded from the 12 multiple-answer keys.
- All 100 question XML trees, including original HTML, keys, feedback, point values, and metadata, retained through an unchanged editable Word-to-QTI round trip. Known malformed Canvas namespace metadata is repaired without changing quiz settings.
- Edits to the sequence, a numerical range, category assignments, matching pairs, a stem, a category label, quiz title, and question order.
- Functional import/preview and Word validation using JSDOM with the shipped application files.
- Student and instructor clean copies exclude the custom source archive; student copies exclude answer-key labels and converter markers.
- Every generated DOCX XML part and the rebuilt QTI XML pass strict lxml parsing.
- Synthetic fresh questions cover all four new types, inclusive/exclusive ranges, alternative numerical answers, extra distractors, invalid order keys/ranges/assignments, and legacy template compatibility.

Seven representative questions spanning all four types and all category layouts were rendered to PDF/PNG for both student and key output. Every sample page was visually inspected, including paragraph breaks, answer-space placement, scientific notation, sequence numbering, and category/matching layouts.

No instructor content or generated exams are included in the application package. A native browser runtime was unavailable for local UI rendering; functional UI checks used JSDOM. Live browser behavior, Microsoft Word saving of editable source parts, and Canvas import/Build/Student Preview still require instructor testing. LibreOffice render checks do not establish Microsoft Word or Canvas behavior.

## Expanded template download

The real Download Word template handler generates 11 complete examples covering all 10 supported types. Tests verify every example's answer fields and points, both numerical variants, matching/category distractors, and exclusion of how-to notes from question text. The template contains no imported source data, even when an instructor quiz is already loaded.

All examples pass DOCX to QTI to editable DOCX to QTI checks with their question XML retained. This also checks that essay and short-answer response placeholders are not treated as choices. The standalone template's Office XML passes strict parsing. All six rendered pages were visually inspected; complete example blocks stay on the same page. The package includes that reviewed DOCX.
