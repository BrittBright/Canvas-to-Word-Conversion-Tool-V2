# Prototype validation

Validated against the instructor-authorized Canvas course export supplied for this project. Instructor content is not included in this application package.

- Parsed 99 supported items: 28 pages, 49 assignments, 1 discussion, 8 announcements, 3 quizzes, 9 external links, and 1 syllabus.
- Preserved 17 modules and recovered all 20 quiz questions from Canvas's full QTI files, rather than the empty Common Cartridge quiz shells.
- Generated 99 separate student Word documents and a ZIP with module folders, linked files, and a conversion report. The test produced 52 embedded image placements.
- Checked the generated Office XML for well-formedness, title preservation, image embedding, student answer-key exclusion, and extracted instructor answers. A multiple-answer question specifically verifies that negated QTI conditions are not treated as correct answers.
- Checked selection filters, module selection, focus retention, preview sanitization, one-item DOCX download, and full-course ZIP download in an independent DOM environment using the actual application bundles. Invalid exports and unsafe ZIP paths are rejected.
- Version 0.1.1 adds strict libxml2 parsing checks for all 98 XML/QTI files. The original export reproduces three failures in quiz metadata caused by an invalid `xmlns:xsi` URI. The targeted namespace repair resolves all three without changing quiz directions or question data. This check supplements the more permissive DOM environment that missed the initial browser failure.
- Version 0.1.2 fixes duplicate built-in Word style definitions. A regression using the production bundles reproduces the previous duplicate IDs and verifies unique style IDs/names, Heading 1–6 names and outline levels, and resolved paragraph/hyperlink references. All 99 course documents pass these additional structural checks. The corrected STEM module overview preserves every document part except the duplicate style definitions; it matches the regenerated source text and heading properties. Its two pages and the six-page student AI quiz were rendered and visually reviewed after the fix.
- Rendered and visually inspected representative Word outputs: the 22-image Google Drive guide, a syllabus assignment with a rubric table, and student/instructor versions of the AI quiz. Layout review led to fixes for percentage image widths, keeping quiz choices together, and keeping table rows together.

The DOM tests use Sharp for image decoding because the test environment lacks a usable local browser. Native browser canvas decoding and the live browser interface still require instructor testing. The private hosted site could not be tested through the cloud browser because it requires sign-in. These checks are not an accessibility certification; review Word's Accessibility Checker and the conversion notes before distribution.

Suggested instructor test: export one screenshot-heavy page, one assignment, one discussion, and one quiz; compare each Word file with Canvas, then try a module ZIP. Check question wording, answer choices, image readability/alt text, heading navigation, tables, and the conversion report.
