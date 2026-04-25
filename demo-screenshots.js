/**
 * Generates 6 portfolio demo screenshots of RedPen by driving the full
 * author workflow:  empty state → code entry → render → annotate → export → viewer.
 *
 * Usage:  node demo-screenshots.js
 * Output: screenshots/ directory with 01_empty.png … 06_exported_viewer.png
 */

'use strict';

const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');

const REPO      = path.resolve(__dirname);
const PORT      = 3000;
const BASE_URL  = `http://localhost:${PORT}`;
const OUT_DIR   = path.join(REPO, 'screenshots');

// ---------------------------------------------------------------------------
// Example content
// ---------------------------------------------------------------------------

const STUDENT    = 'Jane Kim';
const ASSIGNMENT = 'Lab 3 – Algorithms';
const SCORE_EARNED = '17';
const SCORE_TOTAL  = '20';

const CODE = `def calculate_average(numbers):
    sum = 0
    for n in numbers:
        sum = sum + n
    return sum / len(numbers)

def letter_grade(score):
    if score >= 90: return 'A'
    elif score >= 80: return 'B'
    elif score >= 70: return 'C'
    elif score >= 60: return 'D'
    else: return 'F'

scores = [85, 92, 78, 96, 88]
avg = calculate_average(scores)
print("Average:", round(avg, 1))
print("Grade:", letter_grade(avg))
`;

const OVERALL_COMMENT =
  'Good structure overall. A few naming and efficiency improvements would make this more Pythonic.';

// Annotations: [{ lines: [startLine, endLine], tagLabel, text }]
// Lines are 1-indexed.
const ANNOTATIONS = [
  {
    lines: [1, 5],
    tagLabel: 'Good',
    text: 'Clean function name and straightforward logic. ✓',
  },
  {
    lines: [2, 2],
    tagLabel: 'Naming',
    text: '`sum` shadows a Python built-in. Rename to `total` instead.',
  },
  {
    lines: [3, 4],
    tagLabel: 'Efficiency',
    text: 'You can replace this loop with Python\'s built-in `sum()` function:\n\n```python\nreturn sum(numbers) / len(numbers)\n```',
  },
  {
    lines: [7, 12],
    tagLabel: 'Style',
    text: 'One-liner `return` statements are fine but inconsistent with the rest of the file — pick a style and stick with it.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn(
      '/opt/node22/bin/http-server',
      [REPO, '-p', String(PORT), '--cors', '-c-1'],
      { stdio: 'ignore' }
    );
    srv.on('error', reject);
    // Give the server a moment to bind before we start hitting it
    setTimeout(() => resolve(srv), 800);
  });
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${name}`);
}

/**
 * Programmatically create a browser selection over the given code line range,
 * fire a mouseup on #code-lines to trigger the app's comment-button logic,
 * then click the floating "+ Comment" button.
 * Returns false if the button never becomes visible.
 */
async function selectLinesAndOpenModal(page, startLine, endLine) {
  // Use the DOM API to set a selection spanning the target lines and dispatch
  // the mouseup event that the app listens to on #code-lines.
  const selected = await page.evaluate(([sl, el]) => {
    const lines = document.querySelectorAll('#code-lines .line');
    const startEl = lines[sl - 1];
    const endEl   = lines[el - 1];
    if (!startEl || !endEl) return false;

    const startContent = startEl.querySelector('.line-content');
    const endContent   = endEl.querySelector('.line-content');
    if (!startContent || !endContent) return false;

    // Build a range from the start of startContent to the end of endContent
    const range = document.createRange();
    // Start at offset 0 of the first text node (or the element itself)
    const startNode = startContent.firstChild || startContent;
    const endNode   = endContent.lastChild  || endContent;
    const endOffset = endNode.nodeType === Node.TEXT_NODE
      ? endNode.textContent.length
      : endNode.childNodes.length;
    range.setStart(startNode, 0);
    range.setEnd(endNode, endOffset);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // Fire mouseup on the code-lines element — the app's handler reads the
    // selection via setTimeout(updateCommentButton, 0)
    const codeLines = document.getElementById('code-lines');
    codeLines.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    return true;
  }, [startLine, endLine]);

  if (!selected) return false;

  // Wait for the setTimeout(updateCommentButton, 0) to fire and re-render
  await page.waitForTimeout(400);

  const btn = page.locator('#comment-btn');
  const visible = await btn.isVisible().catch(() => false);
  if (!visible) return false;
  await btn.click();
  await page.waitForTimeout(300);
  return true;
}

/**
 * Inside the open comment modal: click the tag chip with the given label,
 * fill the first comment textarea, and save.
 */
async function fillAndSaveModal(page, tagLabel, text) {
  // Click the matching tag chip
  const chip = page.locator('.tag-chip', { hasText: tagLabel });
  if (await chip.count() > 0) await chip.first().click();
  await page.waitForTimeout(100);

  // Fill the first comment textarea
  const textarea = page.locator('#comment-blocks .comment-block-textarea').first();
  await textarea.fill(text);
  await page.waitForTimeout(100);

  // Save
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Starting http-server…');
  const server = await startServer();

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    // ------------------------------------------------------------------
    // 01 – Empty / initial state
    // ------------------------------------------------------------------
    console.log('\n[01] Empty state');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await shot(page, '01_empty.png');

    // ------------------------------------------------------------------
    // 02 – Code entry (filled in but not yet rendered)
    // ------------------------------------------------------------------
    console.log('[02] Code entry');
    await page.fill('#student-name',    STUDENT);
    await page.fill('#assignment-name', ASSIGNMENT);
    await page.fill('#score-earned',    SCORE_EARNED);
    await page.fill('#score-total',     SCORE_TOTAL);
    // Default language is python — no change needed
    await page.fill('#code-input', CODE);
    await page.waitForTimeout(200);
    await shot(page, '02_code_input.png');

    // ------------------------------------------------------------------
    // 03 – Rendered (syntax-highlighted, no annotations yet)
    // ------------------------------------------------------------------
    console.log('[03] Rendered code');
    await page.click('#btn-render');
    await page.waitForTimeout(600);
    await shot(page, '03_rendered.png');

    // ------------------------------------------------------------------
    // 04 – Annotation modal open (first annotation)
    // ------------------------------------------------------------------
    console.log('[04] Annotation modal');
    const firstA = ANNOTATIONS[0];
    const opened = await selectLinesAndOpenModal(page, firstA.lines[0], firstA.lines[1]);
    if (!opened) {
      console.warn('  ! Comment button not visible — retrying with a tighter selection');
      // Fallback: try selecting just the first line
      await selectLinesAndOpenModal(page, firstA.lines[0], firstA.lines[0]);
    }
    await page.waitForTimeout(300);
    // Fill tag and text so the modal looks realistic in the screenshot
    const chip0 = page.locator('.tag-chip', { hasText: firstA.tagLabel });
    if (await chip0.count() > 0) await chip0.first().click();
    const textarea0 = page.locator('#comment-blocks .comment-block-textarea').first();
    await textarea0.fill(firstA.text);
    await page.waitForTimeout(200);
    await shot(page, '04_annotation_modal.png');

    // Save this annotation
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(500);

    // ------------------------------------------------------------------
    // Add remaining annotations (2, 3, 4)
    // ------------------------------------------------------------------
    console.log('[05] Adding remaining annotations…');
    for (const ann of ANNOTATIONS.slice(1)) {
      const ok = await selectLinesAndOpenModal(page, ann.lines[0], ann.lines[1]);
      if (ok) {
        await fillAndSaveModal(page, ann.tagLabel, ann.text);
      } else {
        console.warn(`  ! Skipped annotation on lines ${ann.lines.join('-')}`);
      }
    }

    // Add overall comment
    await page.fill('#overall-comment', OVERALL_COMMENT);
    await page.waitForTimeout(200);

    // Dismiss any open tooltip / selection
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Click somewhere neutral to deselect
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    await shot(page, '05_annotations_view.png');

    // ------------------------------------------------------------------
    // 06 – Exported viewer with tooltip
    // ------------------------------------------------------------------
    console.log('[06] Export + viewer');
    const tmpDir = os.tmpdir();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-export'),
    ]);
    const exportedPath = path.join(tmpDir, 'redpen-export.html');
    await download.saveAs(exportedPath);
    console.log(`  Saved export to ${exportedPath}`);

    const viewerPage = await browser.newPage();
    await viewerPage.setViewportSize({ width: 1280, height: 800 });
    await viewerPage.goto(`file://${exportedPath}`, { waitUntil: 'networkidle' });
    await viewerPage.waitForTimeout(600);

    // Click the first annotation highlight to pop a tooltip
    const firstHighlight = viewerPage.locator('.annotation').first();
    if (await firstHighlight.count() > 0) {
      await firstHighlight.first().click();
      await viewerPage.waitForTimeout(400);
    }

    await shot(viewerPage, '06_exported_viewer.png');
    await viewerPage.close();

    console.log(`\nAll screenshots saved to ${OUT_DIR}/`);
  } finally {
    await browser.close();
    server.kill();
  }
})();
