# QTI Word Studio 1.3.1

A browser-only converter for Canvas QTI 1.2 packages and structured Microsoft Word documents.

The interface uses Brightpoint Community College's published brand palette and institutional logo. Confirm final branding approval before public release outside the college.

## Privacy

Files are processed entirely in the browser. The app has no server, database, analytics, authentication, or upload endpoint.

## Version 1.3.1 scope

QTI-to-Word export options:

- Blank exam: clean student copy without answers or converter markers
- Answer key: clean instructor copy with correct responses marked
- Editable re-upload file: structured copy that preserves converter markers, question types, points, and feedback

Supported question types:

- Multiple choice
- Multiple answer
- True/False
- Essay
- Short answer
- Text-only directions
- Ordering with a complete sequence key
- Numerical exact answers and bounded ranges, including inclusive/exclusive limits
- Categorization with multiple answers per category and unused distractors
- Matching with separate prompts, shared choices, and extra distractors
- Points and general feedback

Question groups, bank references, unknown question types, media, and complex mathematics are flagged for review.

The **Download Word template** button provides 11 worked examples covering all 10 supported types. Numerical examples show both exact answers and bounded ranges. The six-page template includes a starting guide, type-specific instructions outside the import markers, and complete question blocks that can be copied and edited. The same reviewed template is included at `templates/QTI_Word_Studio_Template.docx`.

Template guidance is excluded from quiz content. Essay and short-answer response placeholders are handled separately from answer choices, including when these types are exported to QTI and edited again.

The student copy uses numbered blanks for ordering, response/work space for numerical questions, and lettered choices for matching and categorization. It follows the original prompt's selection instructions; it does not assume every categorization choice must be used. A separate answer key shows the exported sequence, values/ranges, category assignments, and matching pairs. Clinical values and answers are copied from the source; the converter does not verify their subject-matter accuracy.

Multiple-answer keys now exclude options inside negated scoring conditions. Simple stem formatting, explicit superscripts/subscripts, paragraph breaks, and Unicode symbols are retained in printable output. Compact answer sections stay together where possible. Word Title and Heading 1 styles support navigation.

## Editing and re-uploading

The editable instructor DOCX includes the original QTI archive in a custom XML part. Edit that DOCX directly in Word and keep its Source IDs and markers. The clean student and answer-key documents do not contain that archive and cannot be used as re-upload templates. Copying the text into another document can remove the original data; the converter blocks source-linked re-upload when that data is missing.

For imported questions, keep the original Type and number of choices and prompts/categories. Text, titles, points, numerical answers, sequence, pairs, and category keys can be edited. Add a new question block without a Source ID for a different structure. Question blocks can be reordered in a quiz without nested groups. Reordering across exported groups requires a Canvas review.

Unchanged question HTML, answers, scoring conditions, feedback, calculator settings, and Canvas metadata are retained. Key edits update the relevant conditions. Nonstandard scoring or conditional feedback that cannot safely be edited is reported before export or at download. A narrowly identified malformed Canvas XML namespace declaration is repaired. Use a compatible Canvas quiz importer and verify the result in an unpublished sandbox; local conversion tests do not establish Canvas import behavior.

Examples of advanced fields, used after `Stem:` and before `Feedback:`:

```text
Type: Ordering
Choices:
a. Publish
b. Draft
c. Review
Correct order: b, c, a
```

```text
Type: Numerical
Exact: 10
```

Alternative numerical rules can use repeated `Exact:` or `Range:` lines. A bounded tolerance can be expressed as `Range: 9.9 | 10.1`; both limits default to inclusive. An exclusive lower bound is `Range: 9.9 | 10.1 | exclusive | inclusive`. Do not round away the source's accepted limits.

```text
Type: Matching
Choices:
a. Triangle
b. Square
c. Distractor
Prompts:
1. Four sides
2. Three sides
Matches:
1 = b
2 = a
```

Categorization uses the same choice list, `Categories:` for the numbered category names, and `Assignments:` for lines such as `1 = a, c`. Choices may be unused or assigned to more than one category where the question allows it. A matching prompt requires one answer.

## Run locally

Open `index.html` in a modern browser. The bundled JSZip dependency allows the converter to work without an internet connection.

## Publish with GitHub Pages

For an existing installation, replace the application files with this package's contents. Include **question-types.js**, which must remain beside **app.js** and **index.html**. Preserve any repository-specific domain configuration. Refresh the page and confirm **Version 1.3.1** in the header.

1. Create a new repository.
2. Upload the contents of this folder to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)` folder.
6. Save and wait for the HTTPS Pages URL.

## Embed in Canvas

In the Canvas HTML editor, use:

```html
<iframe
  title="QTI Word Studio"
  src="https://YOUR-ACCOUNT.github.io/YOUR-REPOSITORY/"
  width="100%"
  height="1100"
  style="border: 1px solid #c7d2da; border-radius: 8px;"
  loading="lazy"
  allow="clipboard-write">
</iframe>
```

If Canvas removes the iframe or the page is blocked, the GitHub Pages domain must be added to the institution's Canvas iframe allowlist. A normal external link will still work without an iframe.

## Test protocol

1. Export a small quiz from Canvas as QTI.
2. Convert it to Word and verify every stem, option, key, point value, and feedback field.
3. Convert the resulting Word file back to QTI.
4. Import the package into an unpublished Canvas sandbox quiz.
5. Verify it in Build and Student Preview before publishing.

Do not treat a successful import as proof that every field converted correctly.

Development regression checks require an existing `jsdom` installation:

```sh
TEST_NODE_MODULES=/absolute/path/to/node_modules node tests/regression.cjs
# Optional: run the real 100-question test case supplied for this update:
TEST_NODE_MODULES=/absolute/path/to/node_modules node tests/regression.cjs /path/to/quiz.zip
```

The package contains the converter, test code, and worked-example authoring template. The instructor's quiz and converted exams are excluded.
