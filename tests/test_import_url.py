# Behavioral test for the GitHub-URL import mode (redpen-author-github.js).
# window.fetch is stubbed in-page, so this runs fully offline. Asserts the
# contract the import feature promises: field population from the URL, queue
# ghost-replace-then-append semantics, and the partial-failure retry box.
#
# Run: python3 tests/test_import_url.py   (no pytest; exits non-zero on failure)

import sys

from playwright.sync_api import sync_playwright

from testlib import serve_repo, launch_browser

FAKE_FILES = {
    "https://raw.githubusercontent.com/alice/ps4/main/solution.py": "def add(a, b):\n    return a + b\n",
    "https://raw.githubusercontent.com/bob/ps4/main/solution.py": "function add(a, b) { return a + b; }\n",
}

STUB_JS = """
() => {
  const files = %s;
  window.fetch = async (url) => {
    if (files[url] !== undefined) {
      return { ok: true, text: async () => files[url], json: async () => ({}) };
    }
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  };
}
""" % (
    "{" + ", ".join('%r: %r' % (k, v) for k, v in FAKE_FILES.items()) + "}"
).replace("'", '"')


def modal_hidden_wait(page):
    page.wait_for_function(
        "document.getElementById('github-modal-backdrop').classList.contains('hidden')",
        timeout=5000,
    )


def main():
    with serve_repo() as url, sync_playwright() as p:
        browser = launch_browser(p)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(url)
        page.wait_for_selector("#btn-import-github")
        page.evaluate(STUB_JS)

        # --- Case 1: single successful import replaces the pristine submission ---
        page.click("#btn-import-github")
        page.wait_for_selector("#github-modal-backdrop:not(.hidden)")
        page.fill("#github-urls", "https://github.com/alice/ps4/blob/main/solution.py")
        page.click("#github-modal-import")
        modal_hidden_wait(page)

        assert page.input_value("#student-name") == "alice", page.input_value("#student-name")
        assert page.input_value("#assignment-name") == "ps4", page.input_value("#assignment-name")
        assert page.input_value("#language-select") == "python", page.input_value("#language-select")
        code_text = page.inner_text("#code-lines")
        assert "def add" in code_text, code_text
        print("PASS case 1: single import — student/assignment/language/code all correct")

        # --- Case 2: second import appends to the queue (does not clobber) ---
        page.click("#btn-import-github")
        page.wait_for_selector("#github-modal-backdrop:not(.hidden)")
        page.fill("#github-urls", "https://github.com/bob/ps4/blob/main/solution.py")
        page.click("#github-modal-import")
        modal_hidden_wait(page)

        queue_len = page.evaluate("window.Redpen.state.queue.length")
        assert queue_len == 2, queue_len
        print("PASS case 2: queue now has", queue_len, "submissions")

        # --- Case 3: multi-line import with one failing URL keeps the failure in the box ---
        page.click("#btn-import-github")
        page.wait_for_selector("#github-modal-backdrop:not(.hidden)")
        page.fill(
            "#github-urls",
            "https://github.com/alice/ps4/blob/main/solution.py\nhttps://github.com/nobody/x/blob/main/missing.py",
        )
        page.click("#github-modal-import")
        page.wait_for_selector("#github-modal-status:has-text('Imported')", timeout=5000)
        status = page.inner_text("#github-modal-status")
        remaining = page.input_value("#github-urls")
        assert "Imported 1 / 2" in status, status
        assert "missing.py" in remaining and "alice" not in remaining, remaining
        print("PASS case 3: partial-failure status + retry box:", repr(status), "| remaining:", repr(remaining))

        queue_len = page.evaluate("window.Redpen.state.queue.length")
        assert queue_len == 3, queue_len
        print("PASS case 3b: queue grew to", queue_len, "despite one failure")

        if errors:
            print("PAGE ERRORS:", errors)
            sys.exit(1)
        print("\nALL URL-IMPORT CHECKS PASSED")
        browser.close()


if __name__ == "__main__":
    main()
