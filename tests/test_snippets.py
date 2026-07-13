# Behavioral test for the comment snippet library (redpen-author-snippets.js).
# Pins the contract: markdown parsing shapes (headings / bullets / paragraphs,
# fenced code never splits), manager CRUD + localStorage persistence across a
# reload, .md import with duplicate-skipping, and the comment-editor picker
# (insert at cursor, filter, Enter inserts top match).
#
# Run: python3 tests/test_snippets.py   (no pytest; exits non-zero on failure)

import sys

from playwright.sync_api import sync_playwright

from testlib import serve_repo, launch_browser, fixture_path

HEADINGS_MD = """# Comment bank

## Missing docstring
Add a docstring.

## Empty body heading

## Magic numbers
Bad:

```python
# not a heading
x = 42

y = 2
```

Name it.
"""

BULLETS_MD = """- Use meaningful variable names.
- Break this into smaller functions.
  It does three unrelated things.
* Nice use of a dictionary here.
"""

PARAGRAPHS_MD = """Great job overall — clean and readable.

Watch your indentation depth; more than three levels
usually means a helper function is hiding in there.
"""


def parse(page, md):
    return page.evaluate("md => window.Redpen.parseSnippetsMarkdown(md)", md)


def open_comment_modal(page):
    # Render some code, then open the editor programmatically — simulating a
    # real mouse selection is not what this suite is pinning.
    page.evaluate(
        """() => {
          const R = window.Redpen;
          R.commitPastedCode('print(1)\\nprint(2)\\n');
          R.openCommentModal({ startLine: 1, endLine: 1, startCol: 0, endCol: 5 });
        }"""
    )
    page.wait_for_selector("#modal-backdrop:not(.hidden)")


def main():
    with serve_repo() as url, sync_playwright() as p:
        browser = launch_browser(p)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("dialog", lambda d: d.accept())
        page.goto(url)
        page.wait_for_selector("#btn-snippets")

        # --- Case 1: heading-shaped file — titles, empty-body skip, fence guard ---
        parsed = parse(page, HEADINGS_MD)
        titles = [s["title"] for s in parsed]
        assert titles == ["Missing docstring", "Magic numbers"], titles
        assert "# not a heading" in parsed[1]["text"], parsed[1]["text"]
        assert "y = 2" in parsed[1]["text"], parsed[1]["text"]
        print("PASS case 1: headings parse — titles, doc-title/empty skipped, fence intact")

        # --- Case 2: bullet-shaped file — one snippet per top-level bullet ---
        parsed = parse(page, BULLETS_MD)
        assert len(parsed) == 3, parsed
        assert parsed[1]["text"].startswith("Break this into smaller functions."), parsed[1]
        assert "three unrelated things" in parsed[1]["text"], parsed[1]
        assert parsed[0]["title"] == "Use meaningful variable names.", parsed[0]
        print("PASS case 2: bullets parse — continuation lines attached, titles derived")

        # --- Case 3: paragraph-shaped file ---
        parsed = parse(page, PARAGRAPHS_MD)
        assert len(parsed) == 2, parsed
        assert parsed[0]["text"] == "Great job overall — clean and readable.", parsed[0]
        print("PASS case 3: paragraphs parse — one snippet per blank-line group")

        # --- Case 4: manager add + persistence across reload ---
        page.click("#btn-snippets")
        page.wait_for_selector("#snippet-modal-backdrop:not(.hidden)")
        page.click("#btn-add-snippet-row")
        page.fill(".snippet-row .snippet-title-input", "Docstring")
        page.fill(".snippet-row .snippet-text-input", "Add a docstring explaining the function.")
        page.click("#snippet-modal-close")
        page.reload()
        page.wait_for_selector("#btn-snippets")
        page.click("#btn-snippets")
        page.wait_for_selector("#snippet-modal-backdrop:not(.hidden)")
        assert page.input_value(".snippet-row .snippet-title-input") == "Docstring"
        print("PASS case 4: manager row survives a reload via localStorage")

        # --- Case 5: .md import + re-import dedupe ---
        page.set_input_files("#snippet-md-input", fixture_path("snippets_sample.md"))
        page.wait_for_selector("#snippet-import-status:has-text('Imported')")
        status = page.inner_text("#snippet-import-status")
        assert "Imported 3 snippets." in status, status
        rows = page.locator(".snippet-row").count()
        assert rows == 4, rows  # 1 manual + 3 imported
        page.set_input_files("#snippet-md-input", fixture_path("snippets_sample.md"))
        page.wait_for_selector("#snippet-import-status:has-text('Nothing new')")
        assert page.locator(".snippet-row").count() == 4
        print("PASS case 5: import added 3 rows; re-import skipped as duplicates")
        page.click("#snippet-modal-close")

        # --- Case 6: picker inserts into the comment textarea ---
        open_comment_modal(page)
        page.click("#btn-insert-snippet")
        page.wait_for_selector("#snippet-picker:not(.hidden)")
        page.fill("#snippet-picker-filter", "variable names")
        assert page.locator(".snippet-pick").count() == 1
        page.click(".snippet-pick")
        value = page.input_value(".comment-block-textarea")
        assert value == "Your variable names make this easy to read — keep doing that.", value
        assert page.evaluate("document.getElementById('snippet-picker').classList.contains('hidden')")
        assert not page.is_disabled("#modal-save")
        print("PASS case 6: filtered pick inserts text, hides picker, enables Save")

        # --- Case 7: second insert appends with a paragraph break; Enter picks top match ---
        page.click("#btn-insert-snippet")
        page.fill("#snippet-picker-filter", "docstring explaining what")
        page.press("#snippet-picker-filter", "Enter")
        value = page.input_value(".comment-block-textarea")
        assert "keep doing that.\n\nAdd a docstring explaining what" in value, value
        print("PASS case 7: Enter inserts top match, separated by a blank line")

        # --- Case 8: Escape closes the picker first, then the modal ---
        page.click("#btn-insert-snippet")
        page.wait_for_selector("#snippet-picker:not(.hidden)")
        page.keyboard.press("Escape")
        assert page.evaluate("document.getElementById('snippet-picker').classList.contains('hidden')")
        assert not page.evaluate("document.getElementById('modal-backdrop').classList.contains('hidden')")
        page.keyboard.press("Escape")
        assert page.evaluate("document.getElementById('modal-backdrop').classList.contains('hidden')")
        print("PASS case 8: Escape closes picker, then modal")

        if errors:
            print("PAGE ERRORS:", errors)
            sys.exit(1)
        print("\nALL SNIPPET CHECKS PASSED")
        browser.close()


if __name__ == "__main__":
    main()
