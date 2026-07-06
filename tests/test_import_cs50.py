# Behavioral test for the CS50 (submit50) import modes
# (redpen-author-github.js). window.fetch is stubbed in-page, so this runs
# fully offline. Asserts: mode-toggle exclusivity, validation messages,
# auto-pick reporting, the JSON export parse summary, real-name/score
# prefill, SHA-pinned fetches, and token clearing with mode persistence.
#
# Run: python3 tests/test_import_cs50.py   (no pytest; exits non-zero on failure)

import json
import sys

from playwright.sync_api import sync_playwright

from testlib import serve_repo, launch_browser, fixture_path

FIXTURE = fixture_path("cs50_export_sample.json")

# Fake GitHub API: tree requests with a 40-hex SHA ref get a professor.py
# tree (JSON-mode submissions are SHA-pinned); slug refs get a hello.py tree
# (manual mode). Contents requests return a small python file. Every call is
# recorded in window.__calls with its Authorization header.
STUB_JS = """
() => {
  window.__calls = [];
  window.fetch = async (url, opts) => {
    url = String(url);
    window.__calls.push({ url: url, auth: opts && opts.headers && opts.headers.Authorization || null });
    const treeM = url.match(/^https:\\/\\/api\\.github\\.com\\/repos\\/([^/]+)\\/([^/]+)\\/git\\/trees\\/(.+)\\?recursive=1$/);
    if (treeM) {
      const ref = decodeURIComponent(treeM[3]);
      const files = /^[0-9a-f]{40}$/.test(ref)
        ? [{path: 'professor.py', type: 'blob'}, {path: 'README.md', type: 'blob'}, {path: '.cs50.yml', type: 'blob'}]
        : [{path: 'hello.py', type: 'blob'}, {path: 'extra.py', type: 'blob'}, {path: 'sub/notes.txt', type: 'blob'}];
      return { ok: true, status: 200, json: async () => ({ tree: files }), text: async () => '' };
    }
    const contM = url.match(/^https:\\/\\/api\\.github\\.com\\/repos\\/([^/]+)\\/([^/]+)\\/contents\\//);
    if (contM) {
      return { ok: true, status: 200, text: async () => 'print("code of ' + contM[2] + '")\\n', json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
}
"""


def modal_hidden(page):
    return page.evaluate("document.getElementById('github-modal-backdrop').classList.contains('hidden')")


def main():
    with serve_repo() as url, sync_playwright() as p:
        browser = launch_browser(p)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(url)
        page.wait_for_selector("#btn-import-github")
        page.evaluate(STUB_JS)

        # --- Mode toggle shows/hides the right field groups ---
        page.click("#btn-import-github")
        page.wait_for_selector("#github-modal-backdrop:not(.hidden)")
        assert page.is_visible("#github-url-fields") and not page.is_visible("#cs50-fields") and not page.is_visible("#cs50-json-fields")
        page.click("[data-import-mode='cs50']")
        assert not page.is_visible("#github-url-fields") and page.is_visible("#cs50-fields") and not page.is_visible("#cs50-json-fields")
        page.click("[data-import-mode='cs50json']")
        assert not page.is_visible("#github-url-fields") and not page.is_visible("#cs50-fields") and page.is_visible("#cs50-json-fields")
        page.click("[data-import-mode='cs50']")
        print("PASS: mode toggle shows exactly one field group at a time")

        # --- Manual mode validation: slug and token required ---
        page.click("#github-modal-import")
        assert "slug" in page.inner_text("#github-modal-status"), page.inner_text("#github-modal-status")
        page.fill("#cs50-slug", "cs50/problems/2024/x/hello")
        page.fill("#cs50-usernames", "alice\nbob")
        page.click("#github-modal-import")
        assert "token is required" in page.inner_text("#github-modal-status")
        print("PASS: manual-mode validation (missing slug, then missing token)")

        # --- Manual mode success: auto-pick shown, modal stays open ---
        page.fill("#github-token", "ghp_testtoken")
        page.click("#github-modal-import")
        page.wait_for_function("document.getElementById('github-modal-status').textContent.includes('Imported')", timeout=5000)
        status = page.inner_text("#github-modal-status")
        assert "Imported 2 / 2" in status, status
        assert "alice → hello.py" in status and "bob → hello.py" in status, status
        assert not modal_hidden(page), "modal should stay open after CS50 import"
        assert page.input_value("#cs50-usernames") == "", "successful usernames should leave the box"
        queue_len = page.evaluate("window.Redpen.state.queue.length")
        assert queue_len == 2, queue_len
        active = json.loads(page.evaluate(
            "JSON.stringify({n: window.Redpen.state.queue[0].studentName, a: window.Redpen.state.queue[0].assignmentName, l: window.Redpen.state.queue[0].language})"
        ))
        assert active == {"n": "alice", "a": "hello", "l": "python"}, active
        auth = page.evaluate("window.__calls.every(c => c.auth === 'token ghp_testtoken')")
        assert auth, "all CS50 calls must carry the token"
        print("PASS: manual import — picked files reported, assignment name 'hello', queue=2, token on every call")

        # --- JSON mode: parse summary from a submit.cs50.io-shaped fixture ---
        page.click("[data-import-mode='cs50json']")
        page.set_input_files("#cs50-json-input", FIXTURE)
        page.wait_for_function("document.getElementById('cs50-json-summary').textContent.length > 0", timeout=5000)
        summary = page.inner_text("#cs50-json-summary")
        assert "professor" in summary and "6 students" in summary and "check50" in summary, summary
        print("PASS: JSON parse summary:", repr(summary))

        # --- JSON mode import: names, scores, SHA-pinned fetches ---
        page.click("#github-modal-import")
        page.wait_for_function("document.getElementById('github-modal-status').textContent.includes('Imported')", timeout=5000)
        status = page.inner_text("#github-modal-status")
        assert "Imported 6 / 6" in status, status
        assert "ada1 → professor.py" in status, status
        queue_len = page.evaluate("window.Redpen.state.queue.length")
        assert queue_len == 8, queue_len

        bea = json.loads(page.evaluate("JSON.stringify(window.Redpen.state.queue.find(s => s._username === 'bmoss'))"))
        assert bea["studentName"] == "bea", bea["studentName"]  # real name from the export wins
        assert bea["assignmentName"] == "professor", bea["assignmentName"]
        assert bea["score"] == {"earned": 14, "total": 14}, bea["score"]
        assert bea["language"] == "python", bea["language"]
        ada = json.loads(page.evaluate("JSON.stringify(window.Redpen.state.queue.find(s => s._username === 'ada1'))"))
        assert ada["studentName"] == "ada1", ada["studentName"]  # name:null falls back to username
        chen = json.loads(page.evaluate("JSON.stringify(window.Redpen.state.queue.find(s => s._username === 'cchen42'))"))
        assert chen["score"] == {"earned": 12, "total": 14}, chen["score"]
        sha_fetch = page.evaluate("window.__calls.some(c => c.url.includes('/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'))")
        assert sha_fetch, "JSON mode must fetch at the pinned commit SHA"
        print("PASS: JSON import — 6 students, real name used, scores prefilled, SHA-pinned fetch")

        # --- Token cleared on close, mode + parsed JSON preserved ---
        page.click("#github-modal-cancel")
        page.click("#btn-import-github")
        assert page.input_value("#github-token") == "", "token must be cleared on close"
        assert page.is_visible("#cs50-json-fields"), "mode should persist across open/close"
        assert "6 students" in page.inner_text("#cs50-json-summary"), "parsed JSON should persist"
        print("PASS: token cleared on close; mode and parsed file survive reopen")

        if errors:
            print("PAGE ERRORS:", errors)
            sys.exit(1)
        print("\nALL CS50 IMPORT CHECKS PASSED")
        browser.close()


if __name__ == "__main__":
    main()
