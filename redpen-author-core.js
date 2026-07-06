/* redpen — author mode: core
 *
 * First of the author-mode files to load. Creates the window.Redpen
 * namespace, the shared mutable `state` object, the `el` DOM-ref table, and
 * the foundations every other author file builds on: id/model helpers, code
 * rendering, and the empty/rendered view swaps.
 *
 * Load order: core → import → github → comments → tags → autosave → main.
 * Files share
 * state by mutating window.Redpen.state properties (never module-scope `let`s,
 * which would not cross the <script> boundary). Cross-file calls go through
 * `R.`; within-file calls stay bare.
 */

window.Redpen = {};

(function () {
  'use strict';

  const R = window.Redpen;

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------

  const el = {
    studentName: document.getElementById('student-name'),
    assignmentName: document.getElementById('assignment-name'),
    languageSelect: document.getElementById('language-select'),
    scoreEarned: document.getElementById('score-earned'),
    scoreTotal: document.getElementById('score-total'),
    btnTags: document.getElementById('btn-tags'),
    btnExport: document.getElementById('btn-export'),
    // Enable export button since it's now implemented
    initExportButton: function() { const btn = document.getElementById('btn-export'); if(btn) { btn.disabled = false; btn.removeAttribute('title'); } },
    btnNew: document.getElementById('btn-new'),
    codeEmpty: document.getElementById('code-empty'),
    codeInput: document.getElementById('code-input'),
    btnRender: document.getElementById('btn-render'),
    codeView: document.getElementById('code-view'),
    codeLines: document.getElementById('code-lines'),
    codeToolbarStatus: document.getElementById('code-toolbar-status'),
    btnEditCode: document.getElementById('btn-edit-code'),
    overallComment: document.getElementById('overall-comment'),
    overallPreview: document.getElementById('overall-preview'),
    annotationList: document.getElementById('annotation-list'),
    commentBtn: document.getElementById('comment-btn'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modal: document.getElementById('comment-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalRange: document.getElementById('modal-range'),
    modalSave: document.getElementById('modal-save'),
    modalCancel: document.getElementById('modal-cancel'),
    typeSelector: document.getElementById('type-selector'),
    tagChips: document.getElementById('tag-chips'),
    newTagForm: document.getElementById('new-tag-form'),
    newTagColor: document.getElementById('new-tag-color'),
    newTagLabel: document.getElementById('new-tag-label'),
    newTagCreate: document.getElementById('new-tag-create'),
    newTagCancel: document.getElementById('new-tag-cancel'),
    commentBlocks: document.getElementById('comment-blocks'),
    btnAddComment: document.getElementById('btn-add-comment'),
    btnDeleteAnnotation: document.getElementById('btn-delete-annotation'),
    tagModalBackdrop: document.getElementById('tag-modal-backdrop'),
    tagRows: document.getElementById('tag-rows'),
    btnAddTagRow: document.getElementById('btn-add-tag-row'),
    tagModalClose: document.getElementById('tag-modal-close'),
    tooltip: document.getElementById('tooltip'),
    tooltipContent: document.getElementById('tooltip-content'),
    folderInput: document.getElementById('folder-input'),
    csvInput: document.getElementById('csv-input'),
    btnImportGithub: document.getElementById('btn-import-github'),
    githubModalBackdrop: document.getElementById('github-modal-backdrop'),
    githubUrls: document.getElementById('github-urls'),
    githubToken: document.getElementById('github-token'),
    githubModalStatus: document.getElementById('github-modal-status'),
    githubModalCancel: document.getElementById('github-modal-cancel'),
    githubModalImport: document.getElementById('github-modal-import'),
    githubUrlFields: document.getElementById('github-url-fields'),
    cs50Fields: document.getElementById('cs50-fields'),
    cs50Org: document.getElementById('cs50-org'),
    cs50Slug: document.getElementById('cs50-slug'),
    cs50Usernames: document.getElementById('cs50-usernames'),
    cs50JsonFields: document.getElementById('cs50-json-fields'),
    cs50JsonInput: document.getElementById('cs50-json-input'),
    cs50JsonSummary: document.getElementById('cs50-json-summary'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    queueCounter: document.getElementById('queue-counter'),
    btnExportAll: document.getElementById('btn-export-all'),
    queueDrawer: document.getElementById('queue-drawer'),
    queueDrawerHandle: document.getElementById('queue-drawer-handle'),
    queueList: document.getElementById('queue-list'),
    queueCount: document.getElementById('queue-count'),
    autosaveStatus: document.getElementById('autosave-status'),
    btnBackupFile: document.getElementById('btn-backup-file'),
    restoreBanner: document.getElementById('restore-banner'),
    restoreBannerMsg: document.getElementById('restore-banner-msg'),
    restoreBannerRestore: document.getElementById('restore-banner-restore'),
    restoreBannerDiscard: document.getElementById('restore-banner-discard'),
  };
  R.el = el;

  // ------------------------------------------------------------------
  // Shared state
  // ------------------------------------------------------------------

  // All cross-file mutable state lives here. Files reassign these as
  // properties (`state.submission = ...`) so the change is visible
  // everywhere; a module-scope `let` would not cross <script> files.
  //
  //   submission           the active submission (always === queue[activeIdx])
  //   queue / activeIdx    folder-import queue; queue always has >= 1 entry
  //   csvRows              parsed optional names CSV — array of string arrays
  //   sourceLines          active code split into lines, for column clamping
  //   selectionRange       range tracked by the floating "+ Comment" button
  //   editingRange         range locked into the open comment modal
  //   editingAnnotationId  id of the annotation being edited, or null ("new")
  //   editingBlocks        draft comment blocks in the modal
  //   editingTagIds        draft tag ids in the modal
  //   modalView            comment editor view: 'edit' | 'preview' | 'split'
  //   overallView          overall comment view: 'edit' | 'preview'
  const state = {
    submission: null,
    queue: null,
    activeIdx: 0,
    csvRows: [],
    sourceLines: [],
    selectionRange: null,
    editingRange: null,
    editingAnnotationId: null,
    editingBlocks: [],
    editingTagIds: [],
    modalView: 'edit',
    overallView: 'edit',
  };
  R.state = state;

  // ------------------------------------------------------------------
  // Model helpers
  // ------------------------------------------------------------------

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    // Fallback: RFC4122-ish v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function defaultTags() {
    // Seeded on first load and on "New". The spec fixes these five defaults.
    return [
      { id: uuid(), label: 'Logic',      color: '#e74c3c' },
      { id: uuid(), label: 'Style',      color: '#3498db' },
      { id: uuid(), label: 'Naming',     color: '#9b59b6' },
      { id: uuid(), label: 'Efficiency', color: '#f39c12' },
      { id: uuid(), label: 'Good',       color: '#27ae60' },
    ];
  }

  function newSubmission() {
    const now = Date.now();
    return {
      id: uuid(),
      studentName: '',
      assignmentName: '',
      language: 'python',
      code: '',
      score: { earned: null, total: null },
      overallComment: '',
      annotations: [],
      tags: defaultTags(),
      createdAt: now,
      updatedAt: now,
    };
  }

  function findNameInCsv(username) {
    const target = (username || '').trim().toLowerCase();
    if (!target) return null;

    for (const row of state.csvRows) {
      const matchIdx = row.findIndex(cell => (cell || '').trim().toLowerCase() === target);
      if (matchIdx !== -1) {
        // Take all other words on the line, clean them up, and join them
        const nameParts = row.filter((cell, idx) => {
          const val = (cell || '').trim();
          return idx !== matchIdx && val !== '';
        });
        return nameParts.join(' ').trim();
      }
    }
    return null;
  }

  function getAnnotationById(id) {
    for (const a of state.submission.annotations) if (a.id === id) return a;
    return null;
  }

  function getTagById(id) {
    for (const t of state.submission.tags) if (t.id === id) return t;
    return null;
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/"/g, '\\"');
  }

  // ------------------------------------------------------------------
  // Highlight.js configuration + code rendering
  // ------------------------------------------------------------------

  // Language values in the dropdown map directly to highlight.js identifiers
  // except 'html', which hljs aliases via 'xml'.
  const HLJS_ALIAS = { python: 'python', javascript: 'javascript', html: 'xml', css: 'css' };

  /**
   * Run highlight.js on the full source, then split the resulting HTML into
   * an array of one string per source line. Keeps span nesting balanced by
   * closing any still-open tags at a line break and reopening them on the
   * next line — this preserves multi-line tokens (block comments, strings).
   */
  function highlightByLines(source, language) {
    const hlLang = HLJS_ALIAS[language] || 'plaintext';
    let html;
    try {
      html = window.hljs.highlight(source, { language: hlLang, ignoreIllegals: true }).value;
    } catch (_) {
      // Fall back to escaped plain text if the language is unknown.
      html = window.RedpenShared.escapeHtml(source);
    }
    return splitHighlightedByLines(html);
  }

  // Highlight tokens depend only on (code, language); annotation wrapping is
  // a separate pass over the split lines. Cache the last result so annotation
  // add/delete/tag edits don't pay a full re-highlight of the file. The
  // cached line strings are never mutated (the wrap pass builds new strings),
  // so handing out the same array is safe.
  let highlightCache = { code: null, language: null, lines: null };

  function highlightByLinesCached(source, language) {
    if (highlightCache.code !== source || highlightCache.language !== language) {
      highlightCache = { code: source, language: language, lines: highlightByLines(source, language) };
    }
    return highlightCache.lines;
  }

  /**
   * Walk an HTML string that contains only text and `<span …>…</span>` tags
   * (which is what hljs produces) and split it on newline characters,
   * rebalancing spans around each break.
   */
  function splitHighlightedByLines(html) {
    const lines = [];
    const openStack = []; // stack of open tag strings like '<span class="hljs-string">'
    let current = '';
    let i = 0;
    const len = html.length;
    while (i < len) {
      const ch = html[i];
      if (ch === '<') {
        const end = html.indexOf('>', i);
        if (end === -1) { current += html.substring(i); break; }
        const tag = html.substring(i, end + 1);
        if (tag.charAt(1) === '/') {
          openStack.pop();
        } else if (tag.charAt(tag.length - 2) !== '/') {
          openStack.push(tag);
        }
        current += tag;
        i = end + 1;
      } else if (ch === '\n') {
        for (let j = openStack.length - 1; j >= 0; j--) current += '</span>';
        lines.push(current);
        current = openStack.join('');
        i++;
      } else if (ch === '&') {
        // Copy the entire entity so we don't split it.
        const semi = html.indexOf(';', i);
        if (semi === -1 || semi - i > 10) { current += ch; i++; }
        else { current += html.substring(i, semi + 1); i = semi + 1; }
      } else {
        current += ch;
        i++;
      }
    }
    for (let j = openStack.length - 1; j >= 0; j--) current += '</span>';
    lines.push(current);
    return lines;
  }

  /**
   * Render a submission's code into a <code> element. Defaults to the live
   * #code-lines and the active submission — the original behaviour.
   *
   * Passing an explicit `target` element (typically a detached <code>) and a
   * non-active `submission` lets callers render off-screen without disturbing
   * the visible UI. Batch export uses this to avoid cycling the active queue
   * item per submission. For off-screen renders we still need state.submission
   * to point at the rendered submission for the duration of the render (so
   * primaryTagForAnnotation / getTagById resolve against the right tag set),
   * but we swap it back synchronously when the render returns.
   */
  function renderCodeView(target, submission) {
    target = target || el.codeLines;
    submission = submission || state.submission;
    const isLive = target === el.codeLines;
    const code = submission.code;
    if (!code) {
      target.innerHTML = '';
      if (isLive) state.sourceLines = [];
      return;
    }
    const sourceLines = code.split('\n');
    if (isLive) state.sourceLines = sourceLines;

    const savedSubmission = state.submission;
    state.submission = submission;
    try {
      const lineHtmls = highlightByLinesCached(code, submission.language);

      // Apply annotation wrappers per line. Widest first so the bigger range
      // becomes the outer <span> and smaller ranges nest inside it — this is
      // what makes the innermost (most specific) annotation win on click,
      // since inner DOM elements receive the event first. On ties we put
      // block > line-range > span (i.e., a span that happens to cover a full
      // line still nests *inside* a block / line-range on the same line,
      // otherwise clicking the span would resolve to the line-level annotation).
      const annotationsByLine = indexAnnotationsByLine(submission.annotations, sourceLines.length);

      const TYPE_RANK = { block: 2, 'line-range': 1, span: 0 };
      const frag = document.createDocumentFragment();
      for (let i = 0; i < lineHtmls.length; i++) {
        let lineHtml = lineHtmls[i];
        const lineNum = i + 1;
        const lineLen = sourceLines[i].length;
        const wraps = (annotationsByLine[lineNum] || [])
          .map(function (a) {
            const r = colRangeOnLine(a, lineNum, lineLen);
            return { annotation: a, startCol: r[0], endCol: r[1], width: r[1] - r[0] };
          })
          .filter(function (w) { return w.width > 0; });
        wraps.sort(function (x, y) {
          if (y.width !== x.width) return y.width - x.width;
          return (TYPE_RANK[y.annotation.type] || 0) - (TYPE_RANK[x.annotation.type] || 0);
        });

        // Line/block flags are computed from the *unfiltered* list so an empty
        // line in the middle of a multi-line range still renders the wash and
        // border — width-0 wraps get filtered out above but the line itself is
        // still inside the annotation.
        let hasLineRange = false;
        let hasBlock = false;
        let smallestLineLevel = null;
        let smallestLineLevelWidth = Infinity;
        for (const a of annotationsByLine[lineNum] || []) {
          if (a.type !== 'line-range' && a.type !== 'block') continue;
          if (a.type === 'line-range') hasLineRange = true;
          if (a.type === 'block') hasBlock = true;
          const coverage = (a.range.endLine - a.range.startLine + 1);
          if (coverage < smallestLineLevelWidth) {
            smallestLineLevelWidth = coverage;
            smallestLineLevel = a;
          }
        }
        for (const w of wraps) {
          const a = w.annotation;
          const tag = R.primaryTagForAnnotation(a);
          const style = tag ? ' style="--hl:' + window.RedpenShared.escapeAttr(tag.color) + '"' : '';
          const openTag = '<span class="annotation annotation-' + a.type + '" data-annotation-id="' + a.id + '"' + style + '>';
          lineHtml = wrapColumnRange(lineHtml, w.startCol, w.endCol, openTag, '</span>');
        }

        const row = document.createElement('div');
        row.className = 'line';
        if (hasLineRange) row.classList.add('has-line-range');
        if (hasBlock) row.classList.add('has-block');
        // Smallest line-level annotation on this line is used as the fallback
        // click target when the user clicks line-content outside any inner span
        // (e.g., trailing whitespace or an empty line inside a block range).
        // Its first tag's color also drives this line's wash/border.
        if (smallestLineLevel) {
          row.dataset.lineLevelAnnotationId = smallestLineLevel.id;
          const tag = R.primaryTagForAnnotation(smallestLineLevel);
          if (tag) row.style.setProperty('--hl', tag.color);
        }
        row.dataset.line = String(i + 1);
        const gutter = document.createElement('span');
        gutter.className = 'line-number';
        gutter.textContent = String(i + 1);
        const content = document.createElement('span');
        content.className = 'line-content';
        // Empty lines need a zero-width space so the row keeps its height.
        content.innerHTML = lineHtml === '' ? '<span class="empty-placeholder">​</span>' : lineHtml;
        row.appendChild(gutter);
        row.appendChild(content);
        frag.appendChild(row);
      }
      target.innerHTML = '';
      target.appendChild(frag);
    } finally {
      state.submission = savedSubmission;
    }
  }

  function indexAnnotationsByLine(annotations, lineCount) {
    const idx = {};
    for (const a of annotations) {
      const from = a.range.startLine;
      const to = a.range.endLine;
      for (let l = from; l <= to; l++) {
        (idx[l] = idx[l] || []).push(a);
      }
    }
    return idx;
  }

  // For a given annotation on a given line, return [startCol, endCol) clamped
  // to that line's source length. For multi-line ranges, interior lines wrap
  // the whole line; start/end lines use the annotation's explicit columns if
  // provided, otherwise 0..length.
  function colRangeOnLine(annotation, line, lineLength) {
    const r = annotation.range;
    const isStart = line === r.startLine;
    const isEnd = line === r.endLine;
    let startCol = 0;
    let endCol = lineLength;
    if (isStart && typeof r.startCol === 'number') startCol = r.startCol;
    if (isEnd && typeof r.endCol === 'number') endCol = r.endCol;
    startCol = Math.max(0, Math.min(startCol, lineLength));
    endCol = Math.max(0, Math.min(endCol, lineLength));
    return [startCol, endCol];
  }

  /**
   * Wrap a column range of the (already syntax-highlighted) HTML string in an
   * opening/closing tag pair. Columns count logical source characters, not
   * HTML characters. If the range crosses hljs span boundaries, the wrapper
   * is closed before the boundary tag and reopened immediately after so the
   * resulting HTML stays well-formed.
   */
  function wrapColumnRange(html, startCol, endCol, openTag, closeTag) {
    let out = '';
    let col = 0;
    let wrapping = false;
    const shouldWrap = function () { return col >= startCol && col < endCol; };
    const openWrap = function () { if (!wrapping) { out += openTag; wrapping = true; } };
    const closeWrap = function () { if (wrapping) { out += closeTag; wrapping = false; } };

    let i = 0;
    const len = html.length;
    while (i < len) {
      const ch = html[i];
      if (ch === '<') {
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) { out += html.substring(i); break; }
        const tag = html.substring(i, tagEnd + 1);
        const wasWrapping = wrapping;
        closeWrap();
        out += tag;
        if (wasWrapping && col < endCol) openWrap();
        i = tagEnd + 1;
      } else if (ch === '&') {
        const semi = html.indexOf(';', i);
        const entity = semi !== -1 && semi - i <= 10 ? html.substring(i, semi + 1) : ch;
        if (shouldWrap()) openWrap(); else closeWrap();
        out += entity;
        col += 1;
        i += entity.length;
      } else {
        if (shouldWrap()) openWrap(); else closeWrap();
        out += ch;
        col += 1;
        i += 1;
      }
    }
    closeWrap();
    return out;
  }

  // ------------------------------------------------------------------
  // View swaps
  // ------------------------------------------------------------------

  function showEmptyView() {
    el.codeEmpty.classList.remove('hidden');
    el.codeView.classList.add('hidden');
    el.codeView.setAttribute('aria-hidden', 'true');
    el.codeInput.focus();
  }

  function showRenderedView() {
    el.codeEmpty.classList.add('hidden');
    el.codeView.classList.remove('hidden');
    el.codeView.setAttribute('aria-hidden', 'false');
    updateToolbarStatus();
  }

  function updateToolbarStatus() {
    if (state.submission.annotations.length > 0) {
      el.codeToolbarStatus.textContent = 'Code is locked. Clear annotations to edit.';
      el.codeToolbarStatus.classList.add('locked');
      el.btnEditCode.textContent = 'Clear & Edit';
    } else {
      el.codeToolbarStatus.textContent = 'Editable — no annotations yet.';
      el.codeToolbarStatus.classList.remove('locked');
      el.btnEditCode.textContent = 'Edit code';
    }
  }

  function commitPastedCode(raw) {
    const normalized = (raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.trim()) return false;
    state.submission.code = normalized;
    R.markDirty();
    renderCodeView();
    showRenderedView();
    return true;
  }

  function returnToEdit() {
    if (state.submission.annotations.length > 0) {
      const ok = window.confirm(
        'Editing the code will clear all annotations so line numbers stay correct. Continue?'
      );
      if (!ok) return;
      state.submission.annotations = [];
      R.renderAnnotationList();
    }
    R.closeTooltip();
    el.codeInput.value = state.submission.code;
    state.submission.code = '';
    R.markDirty();
    showEmptyView();
  }

  // ------------------------------------------------------------------
  // Boot the initial submission + expose the core API
  // ------------------------------------------------------------------

  state.submission = newSubmission();
  state.queue = [state.submission];

  R.uuid = uuid;
  R.newSubmission = newSubmission;
  R.defaultTags = defaultTags;
  R.findNameInCsv = findNameInCsv;
  R.getAnnotationById = getAnnotationById;
  R.getTagById = getTagById;
  R.cssEscape = cssEscape;
  R.renderCodeView = renderCodeView;
  R.showEmptyView = showEmptyView;
  R.showRenderedView = showRenderedView;
  R.updateToolbarStatus = updateToolbarStatus;
  R.commitPastedCode = commitPastedCode;
  R.returnToEdit = returnToEdit;
})();
