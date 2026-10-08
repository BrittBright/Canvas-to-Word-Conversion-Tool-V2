# Canvas to Word — prototype 0.1.2

A browser-only converter for Canvas course exports. Open `dist/index.html`, choose a `.imscc` course export, preview materials, and select one item, a module, or the whole course. One item downloads as a Word document; multiple items download as separate Word documents in a ZIP, arranged in module order.

The converter handles pages, assignment directions, discussion prompts, announcements, the syllabus, and supported exported quiz questions. It embeds packaged images, preserves source alt text, uses Word heading styles and lists, and adds a conversion report for content requiring review. Student quiz documents omit answer keys by default. Instructor mode includes answers that can be extracted from the exported quiz.

## Run or host

No build step or backend is required. Unzip the portable package and open `index.html` in a current desktop browser, or serve the contents of `dist` as a static website. For GitHub Pages, publish the contents of `dist` at the site's root. Keep `vendor`, `app.js`, `converter.js`, and `style.css` beside `index.html`.

All course parsing, image preparation, and document generation happen in the browser. Course content is not sent to Canvas or a conversion server. There are no Canvas credentials, API calls, external font requests, or analytics. Libraries are bundled for offline use.

Version 0.1.1 repairs a malformed namespace declaration found in exported quiz metadata that strict browser XML parsers reject. The original course file and quiz content are preserved. XML errors now identify the file that failed.

Version 0.1.2 corrects duplicate definitions of the built-in Word Title, Heading 1–6, and Hyperlink styles. Section headings now have one style definition each, with matching outline levels.

## Review before using with students

- Source accessibility problems still need review: missing alt text, instructional images marked decorative, and tables with no header cells are reported.
- External images, videos, embedded activities, and websites are represented by notes and URLs; they are not downloaded. Animated images become still images.
- Supported quiz types include multiple choice, multiple answers, true/false, essays, and text passages. Other types, bank references, and missing questions are flagged for instructor review. New Quizzes and external-tool activities may contain only directions in an ordinary course export.
- Canvas internal links become named references. Include the referenced materials in the export as needed. Linked packaged files can be copied to a `Files` folder in a multi-item ZIP; file references also appear in the documents.
- DesignPLUS headings and panels are flattened into printable content. Styling is intentionally simplified for editing and printing.
- Grades, student submissions, replies, and enrolled-user data are outside this prototype's scope and generally are not part of a course-content export.

This is a prototype requiring instructor testing and Word's Accessibility Checker before distribution. Do not treat a completed conversion as an accessibility certification.

## Dependencies

Bundled JSZip and docx builds are in `dist/vendor`; their license files are included. Application source is plain JavaScript, HTML, and CSS. No instructor content is included in the application package.

The development regression check is `node tests/xml-namespace-regression.cjs`. It requires Python with `lxml` and verifies the quiz namespace failure with a strict XML parser. The Word-style regression is `node tests/docx-styles-regression.cjs`; it uses the bundled production libraries and the same strict XML checks. These dependencies are only for testing; the converter requires no installation.
