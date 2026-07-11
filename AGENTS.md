# redpen — Agent Guide

Read this before touching code. It describes the current repo and the rules you must follow inside it.

## What redpen is

A teacher tool for grading student code with inline, Genius.com-style annotations. Two modes:

- **Author mode** — `index.html` opened in a browser. Teacher pastes code, selects ranges, writes markdown comments with optional code-change suggestions, tags them, and clicks "Export HTML".
- **Viewer mode** — the exported single-file HTML the student opens. Same tooltip UI, read-only, fully offline.

## Hard constraints — DO NOT VIOLATE

These are non-negotiable. Push back on the user before breaking any of them.

- **No build step. Ever.** No bundler, no transpiler, no `package.json`, no `npm install`. The repo is opened by double-clicking `index.html`. If you're tempted to add tooling, you've misunderstood the project.
- **All-browser, vanilla JS only.** No React/Vue/Svelte/etc. Plain `<script>` tags. ES2017+ is fine; target current Chrome/Firefox/Safari.
- **Works fully offline.** Both author mode and exported files must work from `file://` with zero network access. Author mode tries CDN highlight.js but falls back to `vendor/`; exported files inline everything.
- **Dependencies are capped:** `highlight.js` (vendored) today; **JSZip** (vendored at `vendor/jszip.min.js`) is sanctioned as a one-off exception for batch export (zip a folder of student HTML files in the browser). Anything else — refuse and ask first.
- **Exported HTML is self-contained.** All CSS, JS, and submission JSON are inlined into one file. No external links, no remote fonts, no CDNs in the export.
- **No telemetry, no analytics, no remote logging.** Student data never leaves the teacher's machine.

## Repository layout

```
index.html              Author-mode shell. Loads scripts in order:
                        viewer-assets.js → viewer-runtime.js → exporter.js →
                        vendor/jszip.min.js → the seven author-mode modules.
redpen-author-core.js   Author-mode module 1/7. Creates window.Redpen, the
                        shared state object, the el DOM-ref table, model
                        helpers, code rendering, view swaps, and the shared
                        UI idioms (R.selectToggle, R.wireBackdropClose,
                        R.flashText) the other modules reuse.
redpen-author-import.js Author-mode module 2/7. Multi-submission queue,
                        folder/CSV import, queue drawer, batch export. Also
                        owns the shared seam every import source feeds:
                        R.appendToQueue plus R.buildQueueSubmission /
                        R.splitExt / R.isTextFilename (the one place a raw
                        file becomes a queue submission).
redpen-author-github.js Author-mode module 3/7. The "Import from GitHub"
                        modal, three modes: (1) file URLs — public via
                        raw.githubusercontent.com, private via optional token
                        against the Contents API; (2) CS50 manual — submit50
                        pushes each student's work to a PRIVATE repo
                        github.com/<org>/<username> (org defaults to "me50"),
                        branch = problem slug, so the owner/repo semantics
                        invert vs. mode 1 and a token is mandatory — a
                        CLASSIC token (ghp_…) with repo scope; fine-grained
                        tokens can't access me50 org repos and are rejected
                        up front; the branch
                        tree is listed and the likeliest file auto-picked
                        (stem matching the slug's last segment wins); (3) CS50
                        JSON — the per-assignment export downloaded from
                        submit.cs50.io, whose github_url pins the exact
                        submitted commit SHA; real names and check50
                        checks_passed/checks_run prefill studentName and the
                        score. Network access here is opt-in and
                        teacher-initiated, same precedent as the CDN hljs
                        fallback — the exported file stays fully offline and
                        self-contained.
redpen-author-comments.js  Author-mode module 4/7. Selection → range, the
                        comment modal (incl. diff suggestion), tooltip, the
                        sidebar annotation list.
redpen-author-tags.js   Author-mode module 5/7. Tag chips in the modal,
                        standalone tag manager, primary tag lookup.
redpen-author-autosave.js  Author-mode module 6/7. Debounced localStorage
                        autosave, opt-in File System Access backup file,
                        restore banner. Must load before main.
redpen-author-main.js   Author-mode module 7/7. Metadata input wiring, overall
                        comment preview, "New" reset, init() boot.
styles.css              Author-mode styles only. Viewer styles live separately.
exporter.js             Builds the exported HTML string from `submission` +
                        live `#code-lines` innerHTML, then triggers download.
viewer-runtime.js       Runs in BOTH modes. Exposes window.RedpenShared
                        (escapeHtml, escapeAttr, renderMarkdown) for author mode.
                        The viewer-init block (tooltip wiring, click handlers)
                        early-returns if `#submission-data` is absent — author
                        mode never hits it.
viewer-template.html    Reference copy of the export template. The actual
                        template the exporter uses is the string baked into
                        viewer-assets.js — keep them in sync if you edit either.
viewer-assets.js        Source of truth for all inlined export assets:
                          window.RedpenAssets.viewerCss     (template literal,
                                                             EDIT DIRECTLY)
                          window.RedpenAssets.template      (JSON-escaped)
                          window.RedpenAssets.themeCss      (JSON-escaped)
                          window.RedpenAssets.viewerRuntime (JSON-escaped)
                          window.RedpenAssets.hljsMain      (JSON-escaped)
                          window.RedpenAssets.hljsDiff      (JSON-escaped)
                        No build script regenerates this file — viewerCss is
                        edited as a literal; the others must be re-pasted as
                        JSON-escaped strings when their sources change.
vendor/                 highlight.min.js, highlight-diff.min.js, highlight-theme.css,
                        jszip.min.js. highlight.* are author-mode fallback after
                        CDN and also baked into viewer-assets.js for export.
                        jszip is author-mode only (batch export); never inlined
                        into the viewer.
test_headed.py          Playwright smoke test. Loads index.html via a local
                        server on :3000, fills the form, renders, exports.
                        Runs check_drift.py as a precondition. Headed by
                        default; REDPEN_HEADLESS=1 / REDPEN_CHROMIUM=<path>
                        for CI/sandboxes.
tests/                  Headless behavioral suites (plain python3, no
                        pytest): test_import_url.py and test_import_cs50.py
                        pin the import modal's contract — DOM ids, status
                        strings, queue semantics, auto-pick order, token
                        handling. Self-serving (ephemeral-port http.server);
                        fetch is stubbed in-page so they run offline.
                        fixtures/cs50_export_sample.json is a synthesized
                        submit.cs50.io export (fake usernames — never commit
                        real student data here).
check_drift.py          Verifies the strings baked into viewer-assets.js
                        still match their sources (viewer-runtime.js,
                        viewer-template.html, the two hljs vendor files,
                        the theme CSS). Exit 0 / 1. Run after any edit
                        to those sources.
README.md               User-facing overview.
assets/logo.png         Brand asset for the README only.
```

If you find yourself creating a `patch_*.js` file, stop and integrate the change into the main file instead.

### Author-mode module contract

All seven author files share state through `window.Redpen` (referenced as `R`):

- `R.state` holds every cross-file mutable: `submission`, `queue`, `activeIdx`, `csvRows`, `sourceLines`, selection/edit drafts, `modalView`, `overallView`. Files mutate properties (`R.state.queue = ...`) — a module-scope `let` would not cross `<script>` boundaries.
- `R.el` is the shared DOM-ref table (built in `redpen-author-core.js`).
- Cross-file calls go through `R.` (e.g. `R.renderCodeView()`); within-file calls stay bare.
- Each file is its own IIFE under `'use strict'`. There is no build step; load order is enforced by index.html's script loader.

## Data model

Defined in `redpen-author-core.js:newSubmission()`:

```
Submission {
  id, studentName, assignmentName, language ('python'|'javascript'|'html'|'css'),
  code,                                       // raw pasted source
  score: { earned: number|null, total: number|null },
  overallComment,                              // markdown string
  annotations: Annotation[],
  tags: Tag[],
  createdAt, updatedAt
}

Annotation {
  id, type ('span'|'line-range'|'block'),
  range: { startLine, endLine, startCol?, endCol? },  // cols only on 'span'
  comments: Comment[],
  tagIds: string[]
}

Comment { id, text, createdAt }                // text is markdown
Tag     { id, label, color }                   // color is CSS hex
```

`renderMarkdown(source)` accepts either a string or a Comment-shaped object (it pulls `.text` defensively). Always pass `.text` at call sites anyway — the defensive check is belt-and-suspenders.

## How export actually works (read this before editing exporter.js)

1. Author mode renders the code into `#code-lines` with `<span class="annotation" data-annotation-id="...">` wrappers and `<span class="line" data-line="N">` rows. `splitHighlightedByLines` (in `redpen-author-core.js`) preserves hljs token spans across line boundaries; `wrapColumnRange` (same file) inserts annotation wrappers at column boundaries.
2. `exportSubmission(submission)` (`exporter.js:6`) reads `#code-lines.innerHTML` directly. If it's empty, abort with an alert — silent empty exports are a regression.
3. The exporter post-processes that HTML to insert `<sup class="annotation-sup">` markers, exactly once per annotation (the first segment in document order — multi-line ranges produce multiple sibling `.annotation` spans).
4. Print-mode footnotes are generated from `submission.annotations` in the same numeric order.
5. The submission JSON is serialized and `</` is escaped to `<\/` to prevent script-tag breakout.
6. Substitutions into the template MUST use the manual indexOf-walk loop already present (or a function-form replacement). Never `template.replace(placeholder, payload)` with a plain string — `$&`, `$1`, `$$`, etc. inside the payload (especially in `viewer-runtime.js`'s regex replacements) get interpreted and corrupt the export.
7. Output is downloaded via `Blob` + object URL. Filename is `{student}_{assignment}_redpen.html`, sanitized: lowercased, non-`[a-z0-9_-]` collapsed to `_`, runs collapsed, edges trimmed, empty parts replaced with `student`/`assignment`.

If you ever factor `exportSubmission` for batch use, it should return the HTML string and let a caller decide whether to download or zip it.

As of the batch-export feature, that split exists: `buildExportHtml(submission, codeHtml?): string` is the pure builder (throws on validation failures), and `exportSubmission(submission)` is a thin wrapper that handles alert + Blob download. `exportZipFromBuiltEntries(entries)` packages a list of `{filename, html}` into a JSZip blob and downloads it.

`R.renderCodeView(target?, submission?)` accepts an explicit `<code>` element and submission so callers can render off-screen without disturbing the visible UI. Batch export uses this: it creates one detached `<code>` element and reuses it across the queue, calling `R.renderCodeView(off, queue[i])` then `buildExportHtml(queue[i], off.innerHTML)`. The active queue index is never disturbed. When `target`/`submission` are omitted, the function renders the live `#code-lines` against `state.submission` — the original UI path.

## Viewer runtime contract

`viewer-runtime.js` runs in author mode (where it only publishes `window.RedpenShared`) and in the exported file (where the init block also runs because `#submission-data` exists). Don't break this dual-use:

- The `if (!document.getElementById('submission-data')) return;` guard at the top of the viewer-init block is load-bearing. Don't move shared helpers below it.
- Tooltip visibility is controlled exclusively by the `hidden` CSS class. Never re-introduce the HTML `hidden` attribute on `#tooltip` — it caused a first-click-invisible bug that's already fixed.
- `resolveAnnotationFromTarget` implements innermost-wins via DOM walk plus a line-level fallback for clicks on whitespace/wash. Don't replace it with `event.target.closest('.annotation')` alone — you'll lose the line fallback.

## Editing viewer-assets.js

This is the only file that's awkward to edit and it has no automation:

- `viewerCss` is a template literal — edit it directly like any CSS.
- `template`, `themeCss`, `viewerRuntime`, `hljsMain`, `hljsDiff` are JSON-escaped strings. When you change `viewer-template.html`, `viewer-runtime.js`, `vendor/highlight-theme.css`, `vendor/highlight.min.js`, or `vendor/highlight-diff.min.js`, you must re-paste a JSON-escaped copy into the matching slot. Easiest path: `python3 -c "import json; print(json.dumps(open('PATH').read()))"`, then paste the result.
- After any such edit, run `python3 check_drift.py` to confirm the embedded copy matches the source. The smoke test runs it automatically.
- Don't add a build script to "fix" this — the teacher explicitly removed it.

## Testing

The headless behavioral suites in `tests/` pin the import modal's contract
(exact status strings, queue semantics, auto-pick order, token handling).
Run them after any change touching import, the queue, or the modal:

```
python3 tests/test_import_url.py     # GitHub URL mode
python3 tests/test_import_cs50.py    # CS50 manual + JSON modes
```

They start their own server (ephemeral port) and stub `fetch` in-page — no
network, no pytest, no setup. `REDPEN_CHROMIUM=<path>` points them at a
pre-installed browser if Playwright's own download isn't available.

`test_headed.py` is a Playwright smoke test that exercises render + export.
To run it:

```
python3 -m http.server 3000 &     # serve the directory
python3 test_headed.py            # opens a headed Chromium, runs the CUJ
```

(`REDPEN_HEADLESS=1 python3 test_headed.py` for CI/sandboxes.)

Manual testing matters more than the smoke test. After any export-touching change, verify a real submission with at least one of each annotation type (span, line-range, block), overlapping annotations, multiple comments per annotation, a `diff` code block, and an overall comment — open the exported file from `file://` and click each highlight.

## Branching and commits

The repo is a GitHub project (`juliocesardiaz/redpen`). Long-lived branch is `main`; work happens on `claude/...` branches via PR. Match the existing commit style: short imperative subject, optional body, scope prefix only when nearby commits use one (e.g., `fix(viewer): ...`). Don't commit unless the user asks.

## When in doubt

- Default to *fewer* abstractions. A bug fix doesn't need a refactor.
- Don't add comments that restate what the code does. Existing comments mostly explain *why* (e.g., the function-form replace, the line-level fallback) — match that bar.
- Ask the teacher a specific question rather than guessing.
