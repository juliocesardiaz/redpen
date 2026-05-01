/**
 * Generates portfolio demo screenshots of RedPen (with folder-import queue).
 *
 * New in this version:
 *   - Simulates importing a folder of 3 student Python files
 *   - Shows the collapsible queue drawer with all submissions listed
 *   - Demonstrates annotation workflow on the active submission
 *   - Exports the single-submission viewer
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

const REPO     = path.resolve(__dirname);
const PORT     = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR  = path.join(REPO, 'screenshots');

// ---------------------------------------------------------------------------
// Student submission files (filename format:  {username}_{project}.{ext})
// ---------------------------------------------------------------------------

const STUDENTS = [
  {
    filename: 'janekim_lab3.py',
    score: { earned: '17', total: '20' },
    code: `def calculate_average(numbers):
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
`,
  },
  {
    filename: 'bobchen_lab3.py',
    score: { earned: '14', total: '20' },
    code: `def bubble_sort(arr):
    for i in range(len(arr)):
        for j in range(len(arr) - i - 1):
            if arr[j] > arr[j+1]:
                temp = arr[j]
                arr[j] = arr[j+1]
                arr[j+1] = temp
    return arr

nums = [64, 34, 25, 12, 22, 11, 90]
print(bubble_sort(nums))
`,
  },
  {
    filename: 'alicew_lab3.py',
    score: { earned: '19', total: '20' },
    code: `import math

def quadratic(a, b, c):
    discriminant = b**2 - 4*a*c
    if discriminant < 0:
        return None
    x1 = (-b + math.sqrt(discriminant)) / (2*a)
    x2 = (-b - math.sqrt(discriminant)) / (2*a)
    return x1, x2

print(quadratic(1, -5, 6))
`,
  },
];

// Annotations for the active submission (janekim_lab3.py)
const ANNOTATIONS = [
  { lines: [1, 5],  tagLabel: 'Good',       text: 'Clean function name and straightforward logic. ✓' },
  { lines: [2, 2],  tagLabel: 'Naming',     text: '`sum` shadows a Python built-in. Rename to `total` instead.' },
  { lines: [3, 4],  tagLabel: 'Efficiency', text: 'Replace this loop with Python\'s built-in `sum()` function:\n\n```python\nreturn sum(numbers) / len(numbers)\n```' },
  { lines: [7, 12], tagLabel: 'Style',      text: 'One-liner `return` statements are fine but inconsistent with the rest of the file — pick a style and stick with it.' },
];

const OVERALL_COMMENT =
  'Good structure overall. A few naming and efficiency improvements would make this more Pythonic.';

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
    setTimeout(() => resolve(srv), 800);
  });
}

function createTempFiles() {
  const dir = path.join(os.tmpdir(), 'redpen-demo-files');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of STUDENTS) {
    fs.writeFileSync(path.join(dir, s.filename), s.code);
  }
  return dir;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: false });
  console.log(`  ✓ ${name}`);
}

/**
 * Programmatically select code lines and open the "+ Comment" modal.
 */
async function selectLinesAndOpenModal(page, startLine, endLine) {
  const selected = await page.evaluate(([sl, el]) => {
    const lines = document.querySelectorAll('#code-lines .line');
    const startEl = lines[sl - 1];
    const endEl   = lines[el - 1];
    if (!startEl || !endEl) return false;

    const startContent = startEl.querySelector('.line-content');
    const endContent   = endEl.querySelector('.line-content');
    if (!startContent || !endContent) return false;

    const range = document.createRange();
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

    document.getElementById('code-lines').dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, cancelable: true })
    );
    return true;
  }, [startLine, endLine]);

  if (!selected) return false;
  await page.waitForTimeout(400);

  const btn = page.locator('#comment-btn');
  if (!await btn.isVisible().catch(() => false)) return false;
  await btn.click();
  await page.waitForTimeout(300);
  return true;
}

async function fillAndSaveModal(page, tagLabel, text) {
  const chip = page.locator('.tag-chip', { hasText: tagLabel });
  if (await chip.count() > 0) await chip.first().click();
  await page.waitForTimeout(100);
  await page.locator('#comment-blocks .comment-block-textarea').first().fill(text);
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const importDir = createTempFiles();

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
    // 01 – Empty state (shows new topbar with Import folder / Names CSV /
    //      Export all buttons)
    // ------------------------------------------------------------------
    console.log('\n[01] Empty state');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await shot(page, '01_empty.png');

    // ------------------------------------------------------------------
    // 02 – Queue loaded: import 3 student files then open the drawer
    // ------------------------------------------------------------------
    console.log('[02] Import folder → queue drawer');
    // setInputFiles simulates picking a folder; each file gets its own entry.
    await page.setInputFiles('#folder-input', importDir);
    // importFolder is async (reads file text); give it time to settle.
    await page.waitForTimeout(800);

    // Expand the queue drawer
    await page.click('#queue-drawer-handle');
    await page.waitForTimeout(300);

    await shot(page, '02_queue_loaded.png');

    // ------------------------------------------------------------------
    // 03 – Rendered code for the active submission (janekim — auto-rendered
    //      on import because the file has content)
    // ------------------------------------------------------------------
    console.log('[03] Rendered code – Jane Kim');
    // Collapse the drawer so the code panel is fully visible
    await page.click('#queue-drawer-handle');
    await page.waitForTimeout(200);

    // Set score for the active submission
    await page.fill('#score-earned', STUDENTS[0].score.earned);
    await page.fill('#score-total',  STUDENTS[0].score.total);
    await page.waitForTimeout(200);

    await shot(page, '03_rendered.png');

    // ------------------------------------------------------------------
    // 04 – Annotation modal open (first annotation: lines 1-5, "Good")
    // ------------------------------------------------------------------
    console.log('[04] Annotation modal');
    const firstA = ANNOTATIONS[0];
    let opened = await selectLinesAndOpenModal(page, firstA.lines[0], firstA.lines[1]);
    if (!opened) {
      console.warn('  ! Retrying with single line');
      opened = await selectLinesAndOpenModal(page, firstA.lines[0], firstA.lines[0]);
    }
    await page.waitForTimeout(200);

    // Pre-fill tag + text for a realistic screenshot
    const chip0 = page.locator('.tag-chip', { hasText: firstA.tagLabel });
    if (await chip0.count() > 0) await chip0.first().click();
    await page.locator('#comment-blocks .comment-block-textarea').first().fill(firstA.text);
    await page.waitForTimeout(200);

    await shot(page, '04_annotation_modal.png');

    // Save first annotation
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(500);

    // ------------------------------------------------------------------
    // Add remaining annotations silently
    // ------------------------------------------------------------------
    console.log('[05] Adding remaining annotations…');
    for (const ann of ANNOTATIONS.slice(1)) {
      const ok = await selectLinesAndOpenModal(page, ann.lines[0], ann.lines[1]);
      if (ok) await fillAndSaveModal(page, ann.tagLabel, ann.text);
      else console.warn(`  ! Skipped annotation on lines ${ann.lines.join('-')}`);
    }

    await page.fill('#overall-comment', OVERALL_COMMENT);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    await shot(page, '05_annotations_view.png');

    // ------------------------------------------------------------------
    // 06 – Exported viewer with tooltip open
    // ------------------------------------------------------------------
    console.log('[06] Export → viewer');
    const tmpOut = path.join(os.tmpdir(), 'redpen-export.html');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-export'),
    ]);
    await download.saveAs(tmpOut);
    console.log(`  Saved export to ${tmpOut}`);

    const viewerPage = await browser.newPage();
    await viewerPage.setViewportSize({ width: 1280, height: 800 });
    await viewerPage.goto(`file://${tmpOut}`, { waitUntil: 'networkidle' });
    await viewerPage.waitForTimeout(600);

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
