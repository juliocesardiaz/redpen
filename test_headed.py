from playwright.sync_api import sync_playwright
import os

def run_cuj(page):
    page.goto("http://localhost:3000/index.html")
    page.wait_for_timeout(500)

    # 1. Fill student name
    page.locator("#student-name").fill("John Smith")
    page.wait_for_timeout(200)

    # 2. Fill assignment name
    page.locator("#assignment-name").fill("Problem Set 4")
    page.wait_for_timeout(200)

    # 3. Paste some code
    code_input = page.locator("#code-input")
    code_input.fill("def hello():\n    print('Hello World')\n")
    page.wait_for_timeout(200)
    page.locator("#btn-render").click()
    page.wait_for_timeout(500)

    # CHECK DOM CODE LINES!
    code_lines_html = page.evaluate("document.getElementById('code-lines').innerHTML")
    print(f"DEBUG #code-lines: {code_lines_html[:50]}")

    # Export
    with page.expect_download() as download_info:
        page.locator("#btn-export").click()
    download = download_info.value
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        try:
            run_cuj(page)
        finally:
            browser.close()
