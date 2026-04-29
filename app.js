/* redpen — author mode logic
 *
 * Build order: currently at Step 7 (markdown rendering + code blocks).
 * Later steps will extend with export and viewer polish.
 */

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  /** @type {Submission} */
  let submission = newSubmission();

  // Queue of submissions imported from a folder. Always contains at least
  // one entry (the current paste-only submission when nothing was imported).
  // The submission binding above is always === queue[activeIdx]; setActive
  // rebinds both. Existing handlers that mutate `submission.X` follow the
  // module-scope `let` rebind, so they keep targeting the right entry.
  let queue = [submission];
  let activeIdx = 0;

  // Built from the optional CSV picker. Empty Map until the user loads one.
  let nameMap = new Map();

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
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    queueCounter: document.getElementById('queue-counter'),
    btnExportAll: document.getElementById('btn-export-all'),
    queueDrawer: document.getElementById('queue-drawer'),
    queueDrawerHandle: document.getElementById('queue-drawer-handle'),
    queueList: document.getElementById('queue-list'),
    queueCount: document.getElementById('queue-count'),
  };

  // Source-of-truth copy of the code split into lines; used for clamping
  // selection columns so the empty-line placeholder and trailing spaces don't
  // pollute offsets.
  let sourceLines = [];

  // Range currently tracked by the floating "+ Comment" button — tied to the
  // live browser selection and cleared when the selection clears.
  let selectionRange = null;

  // Range locked into the open comment modal. Decoupled from selectionRange
  // because focusing the modal textarea collapses the code-view selection.
  let editingRange = null;

  // When editing an existing annotation, holds its id. Null in "new" mode.
  let editingAnnotationId = null;

  // Draft copy of the comment list being edited. Each block is
  // { id: string|null, text: string, createdAt: number|null }. id/createdAt
  // are null for newly-added-but-not-yet-saved comments.
  let editingBlocks = [];

  // Draft copy of the tag ids attached to the annotation being edited.
  // Applied to the annotation on save.
  let editingTagIds = [];

  // ------------------------------------------------------------------
  // Highlight.js configuration
  // ------------------------------------------------------------------

  // Language values in the dropdown map directly to highlight.js identifiers
  // except 'html', which hljs aliases via 'xml'.
  const HLJS_ALIAS = { python: 'python', javascript: 'javascript', html: 'xml', css: 'css' };

  // ------------------------------------------------------------------
  // Code rendering
  // ------------------------------------------------------------------

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

  function renderCodeView() {
    const code = submission.code;
    if (!code) {
      el.codeLines.innerHTML = '';
      sourceLines = [];
      return;
    }
    sourceLines = code.split('\n');
    const lineHtmls = highlightByLines(code, submission.language);

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
        const tag = primaryTagForAnnotation(a);
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
        const tag = primaryTagForAnnotation(smallestLineLevel);
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
    el.codeLines.innerHTML = '';
    el.codeLines.appendChild(frag);
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
    if (submission.annotations.length > 0) {
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
    submission.code = normalized;
    submission.updatedAt = Date.now();
    renderCodeView();
    showRenderedView();
    return true;
  }

  function returnToEdit() {
    if (submission.annotations.length > 0) {
      const ok = window.confirm(
        'Editing the code will clear all annotations so line numbers stay correct. Continue?'
      );
      if (!ok) return;
      submission.annotations = [];
      renderAnnotationList();
    }
    closeTooltip();
    el.codeInput.value = submission.code;
    submission.code = '';
    submission.updatedAt = Date.now();
    showEmptyView();
  }

  // ------------------------------------------------------------------
  // Queue / folder + CSV import
  // ------------------------------------------------------------------

  const LANG_BY_EXT = {
    py: 'python',
    js: 'javascript',
    html: 'html',
    css: 'css',
  };

  // Extensions that pre-fill the language dropdown (above) plus any other
  // text-ish files we'll happily accept as plain code. Everything else is
  // skipped on import (binary blobs, OS junk, etc.).
  const TEXT_EXTS = new Set([
    'py', 'js', 'html', 'css',
    'txt', 'md', 'java', 'c', 'cpp', 'h', 'hpp', 'ts', 'tsx', 'jsx',
    'go', 'rb', 'rs', 'php', 'sh', 'sql', 'json', 'yml', 'yaml', 'xml',
  ]);

  function parseFilename(name) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    const us = stem.indexOf('_');
    const username = us > 0 ? stem.slice(0, us) : stem;
    const project = us > 0 ? stem.slice(us + 1) : '';
    const language = LANG_BY_EXT[ext] || null;
    return { username, project, language, ext };
  }

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], field = '', inQuotes = false, i = 0;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') { inQuotes = false; i++; continue; }
        field += c; i++;
      } else {
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ',') { row.push(field); field = ''; i++; continue; }
        if (c === '\r') { i++; continue; }
        if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
        field += c; i++;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  function buildNameMap(rows) {
    const m = new Map();
    if (!rows.length) return m;
    const headerKeys = ['username', 'user', 'login', 'id'];
    const start = headerKeys.includes((rows[0][0] || '').trim().toLowerCase()) ? 1 : 0;
    for (let i = start; i < rows.length; i++) {
      const [u, n] = rows[i];
      if (u && n) m.set(u.trim().toLowerCase(), n.trim());
    }
    return m;
  }

  function isPristineSubmission(s) {
    return !s.studentName && !s.assignmentName && !s.code &&
           s.annotations.length === 0 && !s.overallComment;
  }

  async function makeSubmissionFromFile(file, mapping) {
    const parsed = parseFilename(file.name);
    const text = (await file.text()).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const s = newSubmission();
    s._username = parsed.username;
    const lookupKey = (parsed.username || '').toLowerCase();
    s.studentName = (mapping && mapping.get(lookupKey)) || parsed.username;
    s.assignmentName = parsed.project || '';
    s.language = parsed.language || submission.language;
    s.code = text;
    return s;
  }

  async function importFolder(fileList, mapping) {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).filter(function (f) {
      const dot = f.name.lastIndexOf('.');
      const ext = dot > 0 ? f.name.slice(dot + 1).toLowerCase() : '';
      const keep = TEXT_EXTS.has(ext);
      if (!keep) console.log('redpen: skipping non-text file', f.name);
      return keep;
    });
    if (!files.length) {
      alert('No supported text files found in the picked folder.');
      return;
    }
    if (files.length > 100) {
      console.warn('redpen: importing', files.length, 'files — large folders are held entirely in memory.');
    }
    const built = [];
    for (const f of files) {
      try {
        built.push(await makeSubmissionFromFile(f, mapping));
      } catch (e) {
        console.warn('redpen: failed to read', f.name, e);
      }
    }
    appendToQueue(built);
  }

  function appendToQueue(submissions) {
    if (!submissions.length) return;
    // Ghost-replace: if the only existing entry is the pristine boot
    // submission, swap it for the first import so the queue isn't led by an
    // empty placeholder.
    if (queue.length === 1 && isPristineSubmission(queue[0])) {
      queue = submissions.slice();
      activeIdx = 0;
      submission = queue[0];
      loadSubmissionIntoUI();
      checkDuplicates();
      return;
    }
    queue.push.apply(queue, submissions);
    checkDuplicates();
    renderQueueDrawer();
    updateQueueCounter();
    updateExportAllButton();
  }

  function checkDuplicates() {
    const seen = new Map();
    for (const s of queue) {
      const key = (s._username || s.studentName) + '|' + s.assignmentName;
      if (seen.has(key)) {
        console.warn('redpen: duplicate submission key', key);
      } else {
        seen.set(key, true);
      }
    }
  }

  function setActive(idx) {
    if (idx < 0 || idx >= queue.length) return;
    if (idx === activeIdx) return;
    closeCommentModal();
    closeTooltip();
    hideCommentButton();
    activeIdx = idx;
    submission = queue[idx];
    loadSubmissionIntoUI();
  }

  function loadSubmissionIntoUI() {
    el.studentName.value = submission.studentName || '';
    el.assignmentName.value = submission.assignmentName || '';
    el.languageSelect.value = submission.language || 'python';
    el.scoreEarned.value = submission.score && submission.score.earned !== null && submission.score.earned !== undefined ? String(submission.score.earned) : '';
    el.scoreTotal.value = submission.score && submission.score.total !== null && submission.score.total !== undefined ? String(submission.score.total) : '';
    el.overallComment.value = submission.overallComment || '';
    setOverallView('edit');
    if (submission.code && submission.code.length > 0) {
      el.codeInput.value = submission.code;
      renderCodeView();
      showRenderedView();
    } else {
      el.codeInput.value = '';
      showEmptyView();
    }
    renderAnnotationList();
    renderQueueDrawer();
    updateQueueCounter();
    updateExportAllButton();
  }

  function renderQueueDrawer() {
    if (!el.queueList) return;
    el.queueCount.textContent = String(queue.length);
    el.queueList.innerHTML = '';
    queue.forEach(function (s, i) {
      const li = document.createElement('li');
      li.className = 'queue-item' + (i === activeIdx ? ' active' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('data-idx', String(i));
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'queue-item-name';
      nameSpan.textContent = displayLabel(s);
      li.appendChild(nameSpan);
      if (s.annotations && s.annotations.length > 0) {
        const dot = document.createElement('span');
        dot.className = 'queue-dot';
        dot.setAttribute('aria-label', 'Has annotations');
        li.appendChild(dot);
      }
      el.queueList.appendChild(li);
    });
  }

  function displayLabel(s) {
    const username = s._username || '';
    const real = s.studentName || '';
    if (username && real && real !== username) return username + ' (' + real + ')';
    return real || username || '(unnamed)';
  }

  function updateQueueCounter() {
    if (!el.queueCounter) return;
    if (queue.length <= 1) {
      el.queueCounter.textContent = '';
      el.btnPrev.disabled = true;
      el.btnNext.disabled = true;
      return;
    }
    el.queueCounter.textContent = 'Student ' + (activeIdx + 1) + '/' + queue.length + ': ' + displayLabel(submission);
    el.btnPrev.disabled = activeIdx <= 0;
    el.btnNext.disabled = activeIdx >= queue.length - 1;
  }

  function updateExportAllButton() {
    if (!el.btnExportAll) return;
    const enabled = queue.length > 1 && !!window.JSZip;
    el.btnExportAll.disabled = !enabled;
    if (!window.JSZip) {
      el.btnExportAll.title = 'JSZip failed to load';
    } else if (queue.length <= 1) {
      el.btnExportAll.title = 'Import a folder to enable batch export';
    } else {
      el.btnExportAll.title = 'Export all submissions as a zip';
    }
  }

  function prevSubmission() { setActive(activeIdx - 1); }
  function nextSubmission() { setActive(activeIdx + 1); }

  function wireImport() {
    el.folderInput.addEventListener('change', async function (e) {
      const files = e.target.files;
      await importFolder(files, nameMap);
      e.target.value = '';
    });
    el.csvInput.addEventListener('change', async function (e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const rows = parseCsv(text);
        nameMap = buildNameMap(rows);
        
        // Re-derive student names for any entries that were imported before
        // the CSV. Only overwrite entries whose studentName still matches the
        // raw username (i.e., the teacher hasn't manually edited them).
        let touched = 0;
        for (const s of queue) {
          const username = (s._username || '').trim().toLowerCase();
          const current = (s.studentName || '').trim().toLowerCase();
          if (username && nameMap.has(username) && (current === username || current === '')) {
            s.studentName = nameMap.get(username);
            touched++;
          }
        }

        // Visible feedback
        const label = document.getElementById('csv-input-label');
        if (label) {
          const originalText = label.textContent;
          label.textContent = `Names CSV ✓ ${nameMap.size} loaded`;
          setTimeout(() => { label.textContent = originalText; }, 2500);
        }
        console.info('redpen: loaded', nameMap.size, 'name mappings');

        // Always re-render to update the topbar/drawer even if 0 items were "touched"
        // (the active student name or drawer labels might need refresh).
        loadSubmissionIntoUI();
      } catch (err) {
        console.error('redpen: CSV parse failed', err);
        alert('Failed to read CSV: ' + err.message);
      }
      e.target.value = '';
    });
    el.btnPrev.addEventListener('click', prevSubmission);
    el.btnNext.addEventListener('click', nextSubmission);
    el.btnExportAll.addEventListener('click', exportAll);
  }

  function wireQueueDrawer() {
    el.queueDrawerHandle.addEventListener('click', function () {
      const collapsed = el.queueDrawer.classList.toggle('collapsed');
      el.queueDrawerHandle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    el.queueList.addEventListener('click', function (e) {
      const item = e.target.closest('.queue-item');
      if (!item) return;
      const idx = Number(item.dataset.idx);
      if (Number.isFinite(idx)) setActive(idx);
    });
    el.queueList.addEventListener('keydown', function (e) {
      const item = e.target.closest('.queue-item');
      if (!item) return;
      const idx = Number(item.dataset.idx);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActive(idx);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = item.nextElementSibling;
        if (next) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = item.previousElementSibling;
        if (prev) prev.focus();
      }
    });
  }

  async function exportAll() {
    if (!window.JSZip) {
      alert('Batch export unavailable: JSZip did not load.');
      return;
    }
    if (queue.length <= 1) return;
    const originalIdx = activeIdx;
    const entries = [];
    const failures = [];
    for (let i = 0; i < queue.length; i++) {
      setActive(i);
      // Yield once so the synchronous DOM commits land before we read
      // #code-lines.innerHTML inside buildExportHtml.
      await Promise.resolve();
      try {
        const html = window.buildExportHtml(queue[i]);
        const filename = window.slugForSubmission(queue[i]) + '.html';
        entries.push({ filename: filename, html: html });
      } catch (err) {
        failures.push({ idx: i, name: displayLabel(queue[i]), error: err.message });
      }
    }
    setActive(originalIdx);
    if (entries.length === 0) {
      alert('No submissions exported. Issues:\n' + failures.map(function (f) { return '- ' + f.name + ': ' + f.error; }).join('\n'));
      return;
    }
    await window.exportZipFromBuiltEntries(entries, deriveBatchFilename());
    if (failures.length > 0) {
      alert('Exported ' + entries.length + ' / ' + queue.length + '. Skipped:\n' +
        failures.map(function (f) { return '- ' + f.name + ': ' + f.error; }).join('\n'));
    }
  }

  function deriveBatchFilename() {
    const counts = new Map();
    let max = 0;
    let winner = '';
    for (const s of queue) {
      const a = (s.assignmentName || '').trim();
      if (!a) continue;
      const c = (counts.get(a) || 0) + 1;
      counts.set(a, c);
      if (c > max) {
        max = c;
        winner = a;
      }
    }
    const slug = window.slugifyPart(winner);
    if (!slug) return null; // fallback to default in exporter
    return `${slug}_redpen.zip`;
  }

  // ------------------------------------------------------------------
  // Selection → range
  // ------------------------------------------------------------------

  /**
   * Convert a browser Range object inside the code view into logical source
   * line/column coordinates. Returns null if the range isn't within .line
   * elements or is collapsed.
   *
   * The range's startContainer/endContainer may be deep inside nested hljs
   * <span> tokens, so we find the enclosing .line and walk its DOM counting
   * text characters up to the selection point.
   */
  function getLineColumnFromRange(range) {
    if (!range || range.collapsed) return null;
    const startLineEl = findLineAncestor(range.startContainer);
    const endLineEl = findLineAncestor(range.endContainer);
    if (!startLineEl || !endLineEl) return null;

    const startLine = Number(startLineEl.dataset.line);
    const endLine = Number(endLineEl.dataset.line);

    const startCol = clampCol(
      columnInLine(startLineEl, range.startContainer, range.startOffset),
      startLine
    );
    const endCol = clampCol(
      columnInLine(endLineEl, range.endContainer, range.endOffset),
      endLine
    );

    // Normalise order in case the user dragged backwards. getSelection does
    // this for us in most cases but Range from programmatic construction may
    // not.
    if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
      return { startLine: endLine, endLine: startLine, startCol: endCol, endCol: startCol };
    }
    return { startLine, endLine, startCol, endCol };
  }

  function findLineAncestor(node) {
    let n = node;
    if (n && n.nodeType === 3) n = n.parentNode;
    while (n && !(n.classList && n.classList.contains('line'))) n = n.parentNode;
    return n || null;
  }

  function columnInLine(lineEl, container, offset) {
    const content = lineEl.querySelector('.line-content');
    if (!content) return 0;
    // If the selection anchor is outside .line-content (e.g. on the gutter)
    // treat it as column 0 of this line.
    if (container !== content && !content.contains(container)) return 0;

    let col = 0;
    let done = false;

    function walk(node) {
      if (done) return;
      if (node === container) {
        if (container.nodeType === 3) {
          col += offset;
        } else {
          for (let i = 0; i < offset && i < node.childNodes.length; i++) {
            col += textLength(node.childNodes[i]);
          }
        }
        done = true;
        return;
      }
      if (node.nodeType === 3) {
        col += node.nodeValue.length;
        return;
      }
      if (isEmptyPlaceholder(node)) return; // zero-width space for empty lines
      for (let i = 0; i < node.childNodes.length && !done; i++) {
        walk(node.childNodes[i]);
      }
    }

    walk(content);
    return col;
  }

  function textLength(node) {
    if (node.nodeType === 3) return node.nodeValue.length;
    if (isEmptyPlaceholder(node)) return 0;
    let n = 0;
    for (let i = 0; i < node.childNodes.length; i++) n += textLength(node.childNodes[i]);
    return n;
  }

  function isEmptyPlaceholder(node) {
    return node && node.nodeType === 1 && node.classList && node.classList.contains('empty-placeholder');
  }

  function clampCol(col, line) {
    const len = sourceLines[line - 1] ? sourceLines[line - 1].length : 0;
    return Math.max(0, Math.min(col, len));
  }

  // ------------------------------------------------------------------
  // Floating "+ Comment" button
  // ------------------------------------------------------------------

  function onCodeMouseUp() {
    // Defer a tick so getSelection reflects the final selection state
    // (Safari especially).
    setTimeout(updateCommentButton, 0);
  }

  function updateCommentButton() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hideCommentButton();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.codeLines.contains(range.commonAncestorContainer)) {
      hideCommentButton();
      return;
    }
    const coords = getLineColumnFromRange(range);
    if (!coords) { hideCommentButton(); return; }
    // Reject zero-width selections (happens when selection is entirely inside
    // an empty-line placeholder or the gutter).
    if (coords.startLine === coords.endLine && coords.startCol === coords.endCol) {
      hideCommentButton();
      return;
    }
    selectionRange = coords;
    positionCommentButton(range);
  }

  function positionCommentButton(range) {
    // For multi-line selections, getBoundingClientRect() returns a rect that
    // spans the widest line — which anchors the button at the right edge of
    // the viewport, not next to the actual selection end. getClientRects()
    // returns one rect per visual line; the last one is the end of the
    // selection on its final line, which is the right anchor point.
    const rects = range.getClientRects();
    const anchor = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    const btn = el.commentBtn;
    // Park offscreen before unhiding so we can measure without a visible flash
    // at the previous coords.
    btn.style.left = '-9999px';
    btn.style.top = '-9999px';
    btn.classList.remove('hidden');
    const w = btn.offsetWidth;
    let left = anchor.right + 6;
    let top = anchor.top - 4;
    if (top < 8) top = anchor.bottom + 6;
    const maxLeft = window.innerWidth - w - 8;
    if (left > maxLeft) left = Math.max(8, anchor.left - w - 6);
    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
  }

  function hideCommentButton() {
    el.commentBtn.classList.add('hidden');
    selectionRange = null;
  }

  // ------------------------------------------------------------------
  // Comment editor modal
  // ------------------------------------------------------------------

  function openCommentModal(range) {
    if (!range) return;
    editingAnnotationId = null;
    editingRange = range;
    editingBlocks = [blankBlock()];
    editingTagIds = [];
    el.modalTitle.textContent = 'Add comment';
    el.modalRange.textContent = formatRangeLabel(range);
    // Auto-suggest the type: single line → span, multi-line → line range.
    // Block is always manual — the teacher opts into it when they want the
    // left-border treatment for a structured region.
    const suggested = range.startLine === range.endLine ? 'span' : 'line-range';
    setSelectedType(suggested);
    el.btnDeleteAnnotation.classList.add('hidden');
    hideNewTagForm();
    setModalView('edit');
    renderTagChips();
    renderCommentBlocks();
    updateSaveButton();
    el.modalBackdrop.classList.remove('hidden');
    setTimeout(function () { focusFirstBlockTextarea(); }, 0);
  }

  function openCommentModalForEdit(annotationId) {
    const a = getAnnotationById(annotationId);
    if (!a) return;
    closeTooltip();
    editingAnnotationId = a.id;
    editingRange = Object.assign({}, a.range);
    editingBlocks = a.comments.map(function (c) {
      return { id: c.id, text: c.text, createdAt: c.createdAt, diff: newDiffState() };
    });
    if (editingBlocks.length === 0) editingBlocks = [blankBlock()];
    editingTagIds = (a.tagIds || []).slice();
    el.modalTitle.textContent = 'Edit annotation';
    el.modalRange.textContent = formatRangeLabel(a.range);
    setSelectedType(a.type);
    el.btnDeleteAnnotation.classList.remove('hidden');
    hideNewTagForm();
    setModalView('edit');
    renderTagChips();
    renderCommentBlocks();
    updateSaveButton();
    el.modalBackdrop.classList.remove('hidden');
    setTimeout(function () { focusFirstBlockTextarea(); }, 0);
  }

  function blankBlock() {
    return { id: null, text: '', createdAt: null, diff: newDiffState() };
  }

  function newDiffState() {
    // UI-only draft state. Never persisted on the saved Comment — its output
    // is concatenated into the comment's markdown `text` at save time.
    return { expanded: false, before: '', after: '' };
  }

  function focusFirstBlockTextarea() {
    const ta = el.commentBlocks.querySelector('.comment-block-textarea');
    if (ta) ta.focus();
  }

  function setSelectedType(type) {
    const radios = el.typeSelector.querySelectorAll('input[name="annotation-type"]');
    radios.forEach(function (r) {
      r.checked = r.value === type;
      r.parentElement.classList.toggle('selected', r.checked);
    });
  }

  function getSelectedType() {
    const r = el.typeSelector.querySelector('input[name="annotation-type"]:checked');
    return r ? r.value : 'span';
  }

  function closeCommentModal() {
    el.modalBackdrop.classList.add('hidden');
    hideNewTagForm();
    editingRange = null;
    editingAnnotationId = null;
    editingBlocks = [];
    editingTagIds = [];
  }

  function renderCommentBlocks() {
    el.commentBlocks.innerHTML = '';
    for (let i = 0; i < editingBlocks.length; i++) {
      el.commentBlocks.appendChild(buildCommentBlock(i));
    }
  }

  function buildCommentBlock(index) {
    const block = editingBlocks[index];
    const row = document.createElement('div');
    row.className = 'comment-block';
    if (block.id) row.dataset.commentId = block.id;

    const ta = document.createElement('textarea');
    ta.className = 'comment-block-textarea';
    ta.value = block.text;
    ta.spellcheck = false;
    ta.setAttribute('autocomplete', 'off');
    ta.placeholder = index === 0
      ? 'Write a comment. Markdown supported — ```lang for code, - for lists.'
      : 'Additional comment…';
    ta.addEventListener('input', function () {
      editingBlocks[index].text = ta.value;
      if (modalView !== 'edit') updateBlockPreview(index);
      updateSaveButton();
    });
    ta.addEventListener('keydown', handleModalTextareaKey);
    row.appendChild(ta);

    // Preview pane rendered alongside/instead of the textarea depending on
    // the modal view mode. CSS shows/hides via the container's data-view.
    const preview = document.createElement('div');
    preview.className = 'comment-block-preview markdown-body';
    preview.dataset.blockIndex = String(index);
    preview.innerHTML = renderOrEmpty(buildCommentFinalText(block));
    row.appendChild(preview);

    row.appendChild(buildDiffSuggestion(index));

    // The remove button is only meaningful when there is more than one block;
    // removing the last block via × would leave an annotation with no comment,
    // so we hide it in that case and let "Delete annotation" handle it.
    if (editingBlocks.length > 1) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'comment-block-delete';
      del.title = 'Remove this comment';
      del.setAttribute('aria-label', 'Remove this comment');
      del.textContent = '×';
      del.addEventListener('click', function () {
        editingBlocks.splice(index, 1);
        renderCommentBlocks();
        focusFirstBlockTextarea();
        updateSaveButton();
      });
      row.appendChild(del);
    }
    return row;
  }

  // --- Diff suggestion (UI-only; appends a ```diff fence to the comment) ---

  function buildDiffSuggestion(index) {
    const block = editingBlocks[index];
    const section = document.createElement('div');
    section.className = 'diff-suggestion';
    section.dataset.blockIndex = String(index);
    if (block.diff.expanded) section.classList.add('expanded');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'diff-toggle';
    toggle.textContent = block.diff.expanded ? '× Remove suggestion' : '+ Add code suggestion';
    toggle.addEventListener('click', function () { toggleDiffSuggestion(index); });
    section.appendChild(toggle);

    if (!block.diff.expanded) return section;

    const panels = document.createElement('div');
    panels.className = 'diff-panels';

    panels.appendChild(buildDiffField('Before', 'before', index, block.diff.before));
    panels.appendChild(buildDiffField('After',  'after',  index, block.diff.after));

    section.appendChild(panels);
    return section;
  }

  function buildDiffField(labelText, which, index, value) {
    const wrap = document.createElement('div');
    wrap.className = 'diff-field diff-field-' + which;

    const label = document.createElement('label');
    label.className = 'diff-field-label';
    label.textContent = labelText;
    wrap.appendChild(label);

    const ta = document.createElement('textarea');
    ta.className = 'diff-field-textarea';
    ta.spellcheck = false;
    ta.setAttribute('autocomplete', 'off');
    ta.value = value;
    ta.addEventListener('input', function () {
      editingBlocks[index].diff[which] = ta.value;
      if (modalView !== 'edit') updateBlockPreview(index);
      updateSaveButton();
    });
    ta.addEventListener('keydown', handleDiffFieldKey);
    wrap.appendChild(ta);

    label.htmlFor = ta.id = 'diff-' + which + '-' + index;
    return wrap;
  }

  function toggleDiffSuggestion(index) {
    const block = editingBlocks[index];
    if (!block.diff.expanded) {
      // First-expand: pre-fill Before from the annotation's source text using
      // the currently-selected type so span shows the substring and
      // line-range / block show the full affected lines.
      block.diff.expanded = true;
      block.diff.before = getAnnotationSourceText(editingRange, getSelectedType());
      block.diff.after = '';
    } else {
      // Collapsing clears the fields (spec: "Treat as empty; collapsing
      // clears the fields").
      block.diff.expanded = false;
      block.diff.before = '';
      block.diff.after = '';
    }
    rerenderBlock(index);
    if (block.diff.expanded) {
      // Auto-focus the After field when the section first expands.
      const after = el.commentBlocks.querySelector(
        '.diff-suggestion[data-block-index="' + index + '"] .diff-field-after textarea'
      );
      if (after) after.focus();
    }
    if (modalView !== 'edit') updateBlockPreview(index);
    updateSaveButton();
  }

  function rerenderBlock(index) {
    const rows = el.commentBlocks.querySelectorAll('.comment-block');
    if (!rows[index]) return;
    const fresh = buildCommentBlock(index);
    rows[index].replaceWith(fresh);
  }

  function handleDiffFieldKey(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      // Per-spec: Tab inserts a literal tab char; Shift+Tab leaves the field
      // normally (default browser behavior).
      e.preventDefault();
      insertAtCursor(e.currentTarget, '\t');
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveCommentModal();
    } else if ((e.key === 'e' || e.key === 'E') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setModalView(modalView === 'edit' ? 'preview' : 'edit');
    }
  }

  function getAnnotationSourceText(range, type) {
    if (!range || !sourceLines.length) return '';
    const start = Math.max(0, range.startLine - 1);
    const end = Math.min(sourceLines.length - 1, range.endLine - 1);
    if (type === 'span') {
      if (start === end) {
        const line = sourceLines[start] || '';
        return line.substring(
          typeof range.startCol === 'number' ? range.startCol : 0,
          typeof range.endCol === 'number' ? range.endCol : line.length
        );
      }
      // Multi-line span: start col → end of first line, full middle lines,
      // start → endCol on last line.
      const first = sourceLines[start] || '';
      const last = sourceLines[end] || '';
      const parts = [first.substring(typeof range.startCol === 'number' ? range.startCol : 0)];
      for (let i = start + 1; i < end; i++) parts.push(sourceLines[i] || '');
      parts.push(last.substring(0, typeof range.endCol === 'number' ? range.endCol : last.length));
      return parts.join('\n');
    }
    // line-range / block: full affected lines, indentation preserved.
    const lines = [];
    for (let i = start; i <= end; i++) lines.push(sourceLines[i] || '');
    return lines.join('\n');
  }

  /**
   * Build the final markdown string for a block: textarea content plus an
   * optional ```diff fence generated from the UI draft state. Spec rules:
   * strip trailing newlines from each diff field, one blank line between
   * body and fence when both exist, empty interior lines still get their
   * prefix, Both empty → ignore the diff section entirely.
   */
  function buildCommentFinalText(block) {
    const body = (block.text || '').replace(/\s+$/, '');
    const before = block.diff && block.diff.expanded ? (block.diff.before || '').replace(/\n+$/, '') : '';
    const after = block.diff && block.diff.expanded ? (block.diff.after || '').replace(/\n+$/, '') : '';
    if (!block.diff || !block.diff.expanded || (!before && !after)) return body;
    const beforeLines = before ? before.split('\n').map(function (l) { return '- ' + l; }) : [];
    const afterLines = after ? after.split('\n').map(function (l) { return '+ ' + l; }) : [];
    const fence = '```diff\n' + beforeLines.concat(afterLines).join('\n') + '\n```';
    return body ? body + '\n\n' + fence : fence;
  }

  function updateSaveButton() {
    const canSave = editingBlocks.some(function (b) { return !!buildCommentFinalText(b); });
    el.modalSave.disabled = !canSave;
  }

  function renderOrEmpty(text) {
    if (!text || !text.trim()) {
      return '<p class="empty-hint">Nothing to preview yet.</p>';
    }
    return window.RedpenShared.renderMarkdown(text);
  }

  function updateBlockPreview(index) {
    const preview = el.commentBlocks.querySelector(
      '.comment-block-preview[data-block-index="' + index + '"]'
    );
    if (!preview) return;
    preview.innerHTML = renderOrEmpty(buildCommentFinalText(editingBlocks[index]));
  }

  let modalView = 'edit';

  function setModalView(view) {
    modalView = view === 'preview' || view === 'split' ? view : 'edit';
    el.commentBlocks.dataset.view = modalView;
    document.querySelectorAll('[data-modal-view]').forEach(function (b) {
      const active = b.dataset.modalView === modalView;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (modalView !== 'edit') {
      for (let i = 0; i < editingBlocks.length; i++) updateBlockPreview(i);
    }
  }

  function addCommentBlock() {
    editingBlocks.push(blankBlock());
    renderCommentBlocks();
    const all = el.commentBlocks.querySelectorAll('.comment-block-textarea');
    const last = all[all.length - 1];
    if (last) last.focus();
    updateSaveButton();
  }

  function handleModalTextareaKey(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      insertAtCursor(e.currentTarget, '  ');
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveCommentModal();
    } else if ((e.key === 'e' || e.key === 'E') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      // Cycle edit → preview → edit. Split remains an explicit button choice.
      setModalView(modalView === 'edit' ? 'preview' : 'edit');
    }
  }

  function saveCommentModal() {
    // Collect non-empty blocks in order, preserving ids/createdAts where they
    // already exist so the sidebar's "edit" round-trip doesn't churn metadata.
    // Each block's text is its textarea body plus an optional generated
    // ```diff fence built from the UI-only diff-suggestion draft state.
    const now = Date.now();
    const kept = [];
    for (const b of editingBlocks) {
      const text = buildCommentFinalText(b);
      if (!text) continue;
      kept.push({
        id: b.id || uuid(),
        text: text,
        createdAt: typeof b.createdAt === 'number' ? b.createdAt : now,
      });
    }
    if (kept.length === 0) {
      focusFirstBlockTextarea();
      return;
    }
    const type = getSelectedType();

    // Filter out tag ids that were deleted from the tag list since this
    // annotation was first tagged (defensive — the UI should keep them in sync).
    const tagIds = editingTagIds.filter(function (id) { return !!getTagById(id); });

    if (editingAnnotationId === null) {
      if (!editingRange) { closeCommentModal(); return; }
      const range = { startLine: editingRange.startLine, endLine: editingRange.endLine };
      if (type === 'span') {
        range.startCol = editingRange.startCol;
        range.endCol = editingRange.endCol;
      }
      submission.annotations.push({
        id: uuid(),
        type: type,
        range: range,
        comments: kept,
        tagIds: tagIds,
      });
    } else {
      const a = getAnnotationById(editingAnnotationId);
      if (!a) { closeCommentModal(); return; }
      a.type = type;
      if (type === 'span') {
        // If switching to span from a whole-line type, default cols to the
        // full first line so the highlight still visibly lands somewhere.
        if (typeof a.range.startCol !== 'number') a.range.startCol = 0;
        if (typeof a.range.endCol !== 'number') {
          const ln = (sourceLines[a.range.startLine - 1] || '').length;
          a.range.endCol = ln;
        }
      } else {
        delete a.range.startCol;
        delete a.range.endCol;
      }
      a.comments = kept;
      a.tagIds = tagIds;
    }

    submission.updatedAt = now;
    closeCommentModal();
    closeTooltip();
    hideCommentButton();
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    renderCodeView();
    renderAnnotationList();
    updateToolbarStatus();
  }

  function deleteEditingAnnotation() {
    if (editingAnnotationId === null) return;
    const ok = window.confirm('Delete this annotation and all its comments?');
    if (!ok) return;
    const id = editingAnnotationId;
    submission.annotations = submission.annotations.filter(function (a) { return a.id !== id; });
    submission.updatedAt = Date.now();
    closeCommentModal();
    closeTooltip();
    renderCodeView();
    renderAnnotationList();
    updateToolbarStatus();
  }

  function deleteAnnotationById(id) {
    const ok = window.confirm('Delete this annotation?');
    if (!ok) return;
    submission.annotations = submission.annotations.filter(function (a) { return a.id !== id; });
    submission.updatedAt = Date.now();
    if (el.tooltip.dataset.annotationId === id) closeTooltip();
    renderCodeView();
    renderAnnotationList();
    updateToolbarStatus();
  }

  function formatRangeLabel(r) {
    if (r.startLine === r.endLine) {
      if (typeof r.startCol === 'number' && typeof r.endCol === 'number' &&
          !(r.startCol === 0 && r.endCol >= (sourceLines[r.startLine - 1] || '').length)) {
        return 'L' + r.startLine + ':' + r.startCol + '–' + r.endCol;
      }
      return 'L' + r.startLine;
    }
    return 'L' + r.startLine + '–L' + r.endLine;
  }

  // ------------------------------------------------------------------
  // Tooltip (single instance; repositioned + repopulated per open)
  // ------------------------------------------------------------------

  function getAnnotationById(id) {
    for (const a of submission.annotations) if (a.id === id) return a;
    return null;
  }

  /**
   * Resolve a click inside the code view to the annotation whose tooltip
   * should show. Innermost-wins: we climb from event.target looking for the
   * nearest [data-annotation-id]. If the click landed on line-content with no
   * annotation span ancestor (e.g., trailing whitespace or an empty line
   * inside a block range) we fall back to the smallest line-level annotation
   * tagged on that row.
   */
  function resolveAnnotationForClick(target) {
    let node = target;
    while (node && node !== el.codeLines) {
      if (node.dataset && node.dataset.annotationId) return { id: node.dataset.annotationId, anchor: node };
      node = node.parentElement;
    }
    // Line-level fallback
    let lineEl = target;
    while (lineEl && lineEl !== el.codeLines && !(lineEl.classList && lineEl.classList.contains('line'))) {
      lineEl = lineEl.parentElement;
    }
    if (lineEl && lineEl.dataset && lineEl.dataset.lineLevelAnnotationId) {
      return { id: lineEl.dataset.lineLevelAnnotationId, anchor: lineEl.querySelector('.line-content') || lineEl };
    }
    return null;
  }

  function openTooltip(annotationId, anchorEl) {
    const annotation = getAnnotationById(annotationId);
    if (!annotation || !anchorEl) return;
    renderTooltipContent(annotation);
    el.tooltip.dataset.annotationId = annotationId;
    el.tooltip.classList.remove('hidden');
    positionTooltip(anchorEl);
  }

  function closeTooltip() {
    el.tooltip.classList.add('hidden');
    el.tooltip.dataset.annotationId = '';
  }

  function renderTooltipContent(annotation) {
    el.tooltipContent.innerHTML = '';
    if (annotation.tagIds && annotation.tagIds.length > 0) {
      const row = document.createElement('div');
      row.className = 'tooltip-tags';
      for (const id of annotation.tagIds) {
        const t = getTagById(id);
        if (!t) continue;
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.style.setProperty('--tag-color', t.color);
        pill.textContent = t.label;
        row.appendChild(pill);
      }
      if (row.children.length > 0) el.tooltipContent.appendChild(row);
    }
    for (let i = 0; i < annotation.comments.length; i++) {
      if (i > 0) {
        const hr = document.createElement('hr');
        hr.className = 'tooltip-divider';
        el.tooltipContent.appendChild(hr);
      }
      const body = document.createElement('div');
      body.className = 'tooltip-comment markdown-body';
      body.innerHTML = window.RedpenShared.renderMarkdown(annotation.comments[i].text);
      el.tooltipContent.appendChild(body);
    }
  }

  function positionTooltip(anchorEl) {
    const tt = el.tooltip;
    // Park off-screen to measure width/height at current content.
    tt.style.left = '-9999px';
    tt.style.top = '-9999px';
    tt.style.maxHeight = '';
    // Force layout by reading size.
    const ttW = tt.offsetWidth;
    const ttH = tt.offsetHeight;

    // For line-level annotations (line-range / block), the "anchor" may be
    // the whole .line-content. Use the first visible rect of the anchor —
    // placing the tooltip directly below the start of that element is the
    // most readable choice.
    const rects = anchorEl.getClientRects ? anchorEl.getClientRects() : [];
    const rect = rects.length > 0 ? rects[0] : anchorEl.getBoundingClientRect();

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 10;
    const mobile = vw < 560;

    let left;
    let top;
    let placement = 'below';

    if (mobile) {
      // Span 90vw, centred horizontally, below the anchor.
      const target = Math.min(ttW, Math.floor(vw * 0.9));
      left = Math.max(margin, Math.floor((vw - target) / 2));
    } else {
      left = rect.left;
    }

    top = rect.bottom + gap;
    if (top + ttH > vh - margin) {
      const above = rect.top - gap - ttH;
      if (above >= margin) { top = above; placement = 'above'; }
      else {
        // Not enough room either way — keep below but cap height with scroll.
        tt.style.maxHeight = (vh - top - margin) + 'px';
      }
    }

    const maxLeft = vw - margin - ttW;
    if (left > maxLeft) left = Math.max(margin, maxLeft);
    if (left < margin) left = margin;

    tt.style.left = left + 'px';
    tt.style.top = top + 'px';
    tt.dataset.placement = placement;

    // Position arrow horizontally under the anchor's mid-point, clamped so
    // it never runs off the tooltip's rounded corners.
    const arrow = tt.querySelector('.tooltip-arrow');
    const anchorMid = rect.left + rect.width / 2;
    const rawX = anchorMid - left;
    const arrowX = Math.max(18, Math.min(ttW - 18, rawX));
    arrow.style.left = arrowX + 'px';
  }

  function repositionTooltipIfOpen() {
    if (el.tooltip.classList.contains('hidden')) return;
    const id = el.tooltip.dataset.annotationId;
    if (!id) return;
    // Re-anchor on the first span that still matches this annotation id.
    const anchor = el.codeLines.querySelector('[data-annotation-id="' + cssEscape(id) + '"]');
    if (!anchor) { closeTooltip(); return; }
    positionTooltip(anchor);
  }

  // ------------------------------------------------------------------
  // Tags
  // ------------------------------------------------------------------

  function getTagById(id) {
    for (const t of submission.tags) if (t.id === id) return t;
    return null;
  }

  function primaryTagForAnnotation(a) {
    if (!a.tagIds || a.tagIds.length === 0) return null;
    for (const id of a.tagIds) {
      const t = getTagById(id);
      if (t) return t;
    }
    return null;
  }

  /** Render the multi-select chip list inside the comment modal. */
  function renderTagChips() {
    el.tagChips.innerHTML = '';
    for (const t of submission.tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.dataset.tagId = t.id;
      chip.style.setProperty('--tag-color', t.color);
      const selected = editingTagIds.indexOf(t.id) !== -1;
      if (selected) chip.classList.add('selected');
      chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
      const dot = document.createElement('span');
      dot.className = 'tag-chip-dot';
      dot.style.background = t.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(t.label));
      chip.addEventListener('click', function () {
        toggleEditingTag(t.id);
      });
      el.tagChips.appendChild(chip);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'tag-chip tag-chip-add';
    addBtn.textContent = '+ Tag';
    addBtn.addEventListener('click', showNewTagForm);
    el.tagChips.appendChild(addBtn);
  }

  function toggleEditingTag(id) {
    const idx = editingTagIds.indexOf(id);
    if (idx === -1) editingTagIds.push(id);
    else editingTagIds.splice(idx, 1);
    renderTagChips();
  }

  function showNewTagForm() {
    el.newTagForm.classList.remove('hidden');
    el.newTagLabel.value = '';
    el.newTagColor.value = pickNextDefaultColor();
    el.newTagLabel.focus();
  }

  function hideNewTagForm() {
    el.newTagForm.classList.add('hidden');
  }

  /** Cycle through a palette so new tags don't all come out as the same blue. */
  function pickNextDefaultColor() {
    const palette = ['#3498db', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
    const used = new Set(submission.tags.map(function (t) { return t.color.toLowerCase(); }));
    for (const c of palette) if (!used.has(c.toLowerCase())) return c;
    return palette[submission.tags.length % palette.length];
  }

  function createTagFromForm() {
    const label = el.newTagLabel.value.trim();
    if (!label) { el.newTagLabel.focus(); return; }
    const color = el.newTagColor.value || '#3498db';
    const tag = { id: uuid(), label: label, color: color };
    submission.tags.push(tag);
    submission.updatedAt = Date.now();
    // Auto-select the newly-created tag on the annotation being edited.
    if (!el.modalBackdrop.classList.contains('hidden')) {
      editingTagIds.push(tag.id);
    }
    hideNewTagForm();
    renderTagChips();
    if (!el.tagModalBackdrop.classList.contains('hidden')) renderTagRows();
  }

  // ------------------------------------------------------------------
  // Tag manager modal
  // ------------------------------------------------------------------

  function openTagManager() {
    renderTagRows();
    el.tagModalBackdrop.classList.remove('hidden');
    // Focus the first label input so keyboard editing is immediate.
    setTimeout(function () {
      const first = el.tagRows.querySelector('.tag-label-input');
      if (first) first.focus();
    }, 0);
  }

  function closeTagManager() {
    el.tagModalBackdrop.classList.add('hidden');
    // Re-render anything that depends on tags since we may have renamed /
    // recoloured / deleted tags.
    renderCodeView();
    renderAnnotationList();
    if (!el.modalBackdrop.classList.contains('hidden')) {
      // Drop any editingTagIds that no longer exist.
      editingTagIds = editingTagIds.filter(function (id) { return !!getTagById(id); });
      renderTagChips();
    }
  }

  function renderTagRows() {
    el.tagRows.innerHTML = '';
    for (const t of submission.tags) el.tagRows.appendChild(buildTagRow(t));
  }

  function buildTagRow(tag) {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.dataset.tagId = tag.id;

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'tag-swatch';
    swatch.value = tag.color;
    swatch.setAttribute('aria-label', 'Color for ' + tag.label);
    swatch.addEventListener('input', function () {
      tag.color = swatch.value;
      submission.updatedAt = Date.now();
    });
    row.appendChild(swatch);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'tag-label-input';
    labelInput.value = tag.label;
    labelInput.maxLength = 40;
    labelInput.setAttribute('aria-label', 'Tag name');
    labelInput.addEventListener('input', function () {
      tag.label = labelInput.value;
      submission.updatedAt = Date.now();
    });
    row.appendChild(labelInput);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tag-delete';
    del.title = 'Delete tag';
    del.setAttribute('aria-label', 'Delete tag ' + tag.label);
    del.textContent = '×';
    del.addEventListener('click', function () { deleteTag(tag.id); });
    row.appendChild(del);
    return row;
  }

  function deleteTag(id) {
    const usage = submission.annotations.reduce(function (acc, a) {
      return acc + ((a.tagIds || []).indexOf(id) !== -1 ? 1 : 0);
    }, 0);
    if (usage > 0) {
      const msg = 'This tag is applied to ' + usage +
        (usage === 1 ? ' annotation' : ' annotations') +
        '. Remove it from all of them and delete the tag?';
      if (!window.confirm(msg)) return;
    }
    submission.tags = submission.tags.filter(function (t) { return t.id !== id; });
    for (const a of submission.annotations) {
      if (!a.tagIds) continue;
      a.tagIds = a.tagIds.filter(function (tid) { return tid !== id; });
    }
    submission.updatedAt = Date.now();
    renderTagRows();
  }

  function addNewTagRow() {
    const tag = { id: uuid(), label: 'New tag', color: pickNextDefaultColor() };
    submission.tags.push(tag);
    submission.updatedAt = Date.now();
    renderTagRows();
    // Focus and select the label of the newly-added row so it's immediately
    // rename-ready.
    const row = el.tagRows.querySelector('[data-tag-id="' + cssEscape(tag.id) + '"] .tag-label-input');
    if (row) { row.focus(); row.select(); }
  }

  // ------------------------------------------------------------------
  // Sidebar annotation list
  // ------------------------------------------------------------------

  function renderAnnotationList() {
    // Refresh the queue drawer dot indicator alongside the right sidebar list,
    // since both reflect annotations.length for the active submission.
    if (el.queueList) renderQueueDrawer();
    el.annotationList.innerHTML = '';
    if (submission.annotations.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = 'No annotations yet. Select code to add one.';
      el.annotationList.appendChild(hint);
      return;
    }
    const sorted = submission.annotations.slice().sort(function (a, b) {
      if (a.range.startLine !== b.range.startLine) return a.range.startLine - b.range.startLine;
      return (a.range.startCol || 0) - (b.range.startCol || 0);
    });
    for (const a of sorted) el.annotationList.appendChild(buildSidebarEntry(a));
  }

  function buildSidebarEntry(a) {
    const firstText = a.comments[0] ? a.comments[0].text : '';
    const preview = firstText.length > 80 ? firstText.substring(0, 80) + '…' : firstText;
    const commentCount = a.comments.length;

    const item = document.createElement('div');
    item.className = 'annotation-item';
    item.dataset.annotationId = a.id;

    const head = document.createElement('div');
    head.className = 'annotation-item-head';

    const range = document.createElement('span');
    range.className = 'annotation-range';
    range.textContent = formatRangeLabel(a.range);
    head.appendChild(range);

    const typeEl = document.createElement('span');
    typeEl.className = 'annotation-type';
    typeEl.textContent = a.type;
    head.appendChild(typeEl);

    if (commentCount > 1) {
      const count = document.createElement('span');
      count.className = 'annotation-count';
      count.textContent = commentCount + ' comments';
      head.appendChild(count);
    }

    const spacer = document.createElement('span');
    spacer.className = 'annotation-head-spacer';
    head.appendChild(spacer);

    if (a.tagIds && a.tagIds.length > 0) {
      const pills = document.createElement('span');
      pills.className = 'annotation-tags';
      for (const id of a.tagIds) {
        const t = getTagById(id);
        if (!t) continue;
        const pill = document.createElement('span');
        pill.className = 'tag-pill tag-pill-sm';
        pill.style.setProperty('--tag-color', t.color);
        pill.textContent = t.label;
        pills.appendChild(pill);
      }
      if (pills.children.length > 0) head.appendChild(pills);
    }

    const actions = document.createElement('div');
    actions.className = 'annotation-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'annotation-action';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit annotation');
    editBtn.innerHTML = '&#9998;'; // pencil ✎
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openCommentModalForEdit(a.id);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'annotation-action annotation-action-danger';
    delBtn.title = 'Delete';
    delBtn.setAttribute('aria-label', 'Delete annotation');
    delBtn.textContent = '×';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteAnnotationById(a.id);
    });
    actions.appendChild(delBtn);

    head.appendChild(actions);
    item.appendChild(head);

    const previewEl = document.createElement('div');
    previewEl.className = 'annotation-preview';
    previewEl.textContent = preview;
    item.appendChild(previewEl);

    item.addEventListener('click', function () { scrollToAnnotation(a.id); });
    return item;
  }

  function scrollToAnnotation(id) {
    const span = el.codeLines.querySelector('[data-annotation-id="' + cssEscape(id) + '"]');
    if (!span) return;
    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    span.classList.add('flash');
    setTimeout(function () { span.classList.remove('flash'); }, 900);
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return s.replace(/"/g, '\\"');
  }

  // ------------------------------------------------------------------
  // Metadata inputs
  // ------------------------------------------------------------------

  function wireMetadata() {
    el.studentName.addEventListener('input', function () {
      submission.studentName = el.studentName.value;
      submission.updatedAt = Date.now();
      renderQueueDrawer();
      updateQueueCounter();
    });
    el.assignmentName.addEventListener('input', function () {
      submission.assignmentName = el.assignmentName.value;
      submission.updatedAt = Date.now();
    });
    el.languageSelect.addEventListener('change', function () {
      submission.language = el.languageSelect.value;
      submission.updatedAt = Date.now();
      // Re-render the code view with the newly selected language if code is
      // already pasted. Annotations would need the same language context, so
      // in later steps consider whether to lock language alongside code.
      if (submission.code) renderCodeView();
    });
    el.scoreEarned.addEventListener('input', function () {
      const v = el.scoreEarned.value === '' ? null : Number(el.scoreEarned.value);
      submission.score.earned = Number.isFinite(v) ? v : null;
      submission.updatedAt = Date.now();
    });
    el.scoreTotal.addEventListener('input', function () {
      const v = el.scoreTotal.value === '' ? null : Number(el.scoreTotal.value);
      submission.score.total = Number.isFinite(v) ? v : null;
      submission.updatedAt = Date.now();
    });
    el.overallComment.addEventListener('input', function () {
      submission.overallComment = el.overallComment.value;
      submission.updatedAt = Date.now();
      // Live-update the preview when it's currently showing.
      if (overallView === 'preview') renderOverallPreview();
    });

    // Edit / Preview toggle for the overall comment.
    const toggleBtns = document.querySelectorAll('[data-overall-view]');
    toggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setOverallView(btn.dataset.overallView);
      });
    });
  }

  // ------------------------------------------------------------------
  // Overall comment preview
  // ------------------------------------------------------------------

  let overallView = 'edit';

  function setOverallView(view) {
    overallView = view === 'preview' ? 'preview' : 'edit';
    document.querySelectorAll('[data-overall-view]').forEach(function (b) {
      const active = b.dataset.overallView === overallView;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (overallView === 'preview') {
      renderOverallPreview();
      el.overallComment.classList.add('hidden');
      el.overallPreview.classList.remove('hidden');
    } else {
      el.overallComment.classList.remove('hidden');
      el.overallPreview.classList.add('hidden');
    }
  }

  function renderOverallPreview() {
    const src = submission.overallComment || '';
    if (!src.trim()) {
      el.overallPreview.innerHTML = '<p class="empty-hint">Nothing to preview yet.</p>';
      return;
    }
    el.overallPreview.innerHTML = window.RedpenShared.renderMarkdown(src);
  }

  // ------------------------------------------------------------------
  // Markdown renderer (spec's supported subset, no library)
  // ------------------------------------------------------------------

  // Aliases map user-written fence languages onto hljs grammar names. Any
  // language not listed falls back to plain monospace inside the <pre><code>.
  const MD_LANG_ALIAS = {
    python: 'python', py: 'python',
    javascript: 'javascript', js: 'javascript',
    html: 'xml', xml: 'xml',
    css: 'css',
    diff: 'diff', patch: 'diff',
  };

  /**
   * Render a trusted-teacher-authored markdown string to HTML. Supported:
   *   `code`               inline code
   *   ```lang\n...\n```    fenced code block (syntax-highlighted when known)
   *   **bold**
   *   *italic*
   *   - item (consecutive lines form one <ul>)
   *   [label](url)
   * Ordering matches the spec: extract fenced, extract inline, handle
   * lists / paragraphs, apply inline rules, then restore placeholders last
   * so code contents are never touched by the inline pass.
   */
  function applyInline(s) {
    // Bold before italic so **word** isn't partially consumed by * rules.
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (_m, label, url) {
      return '<a href="' + window.RedpenShared.escapeAttr(url) + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    return s;
  }

  function renderFencedBlock(block) {
    const lang = block.lang || '';
    const hljsLang = MD_LANG_ALIAS[lang];
    let content;
    let codeClass = '';
    const hasGrammar = hljsLang && window.hljs &&
      (window.hljs.getLanguage ? !!window.hljs.getLanguage(hljsLang) : true);
    if (hasGrammar) {
      try {
        content = window.hljs.highlight(block.code, { language: hljsLang, ignoreIllegals: true }).value;
        codeClass = ' class="hljs language-' + hljsLang + '"';
      } catch (_) {
        content = window.RedpenShared.escapeHtml(block.code);
      }
    } else {
      content = window.RedpenShared.escapeHtml(block.code);
    }
    const label = lang ? '<span class="md-code-lang">' + window.RedpenShared.escapeHtml(lang) + '</span>' : '';
    // Copy button reads the raw text from the <code> element at click time,
    // so we don't need to round-trip the source through an attribute.
    const copy = '<button type="button" class="md-code-copy" data-md-copy title="Copy code"><span class="md-copy-label">Copy</span></button>';
    return '<div class="md-code-wrap">' + label + copy +
      '<pre class="md-code-pre"><code' + codeClass + '>' + content + '</code></pre></div>';
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------

  function wireCodeInput() {
    el.btnRender.addEventListener('click', function () {
      if (!commitPastedCode(el.codeInput.value)) {
        el.codeInput.focus();
      }
    });

    // Paste handler: let the browser write into the textarea, then auto-render
    // on the next tick. This gives an instant "paste and see it highlighted"
    // feel without needing to click Render.
    el.codeInput.addEventListener('paste', function () {
      setTimeout(function () { commitPastedCode(el.codeInput.value); }, 0);
    });

    el.btnEditCode.addEventListener('click', returnToEdit);
  }

  function wireCopyButton() {
    // Delegated handler covers every rendered code block (tooltip, overall
    // preview, comment modal preview). Reads the raw text from the <code>
    // element so syntax-highlighting markup doesn't pollute the clipboard.
    document.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('[data-md-copy]');
      if (!btn) return;
      e.stopPropagation();
      const wrap = btn.closest('.md-code-wrap');
      if (!wrap) return;
      const codeEl = wrap.querySelector('pre code');
      if (!codeEl) return;
      const text = codeEl.innerText;
      const label = btn.querySelector('.md-copy-label');
      function flash(msg) {
        if (!label) return;
        const prev = label.textContent;
        label.textContent = msg;
        setTimeout(function () { label.textContent = prev; }, 1200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { flash('Copied'); },
          function () { flash('Failed'); }
        );
      } else {
        // Legacy fallback for browsers without the async clipboard API.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash('Copied'); }
        catch (_) { flash('Failed'); }
        document.body.removeChild(ta);
      }
    });
  }

  function wireTooltip() {
    // Click inside the code view opens/toggles the tooltip for the resolved
    // annotation. Use event.target directly so the innermost annotation wins.
    el.codeLines.addEventListener('click', function (e) {
      // Ignore clicks that are the tail of a drag-selection — those should
      // not open a tooltip.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const hit = resolveAnnotationForClick(e.target);
      if (!hit) return;
      e.stopPropagation();
      if (el.tooltip.dataset.annotationId === hit.id && !el.tooltip.classList.contains('hidden')) {
        closeTooltip();
        return;
      }
      openTooltip(hit.id, hit.anchor);
    });

    // Cross-element hover: a span annotation that crosses hljs token
    // boundaries becomes several sibling <span>s. Rather than relying on
    // :hover (which fires per-element) we track the annotation under the
    // cursor and toggle a .hovered class on every DOM element that shares
    // the id, plus the .line rows for a line-level annotation's full range.
    let hoveredAnnotationId = null;
    function applyHovered(id) {
      const parts = el.codeLines.querySelectorAll('[data-annotation-id="' + cssEscape(id) + '"]');
      parts.forEach(function (p) { p.classList.add('hovered'); });
      const a = getAnnotationById(id);
      if (a && (a.type === 'line-range' || a.type === 'block')) {
        for (let ln = a.range.startLine; ln <= a.range.endLine; ln++) {
          const row = el.codeLines.querySelector('.line[data-line="' + ln + '"]');
          if (row) row.classList.add('hovered');
        }
      }
    }
    function clearHovered() {
      const parts = el.codeLines.querySelectorAll('.annotation.hovered, .line.hovered');
      parts.forEach(function (p) { p.classList.remove('hovered'); });
    }
    function setHovered(id) {
      if (id === hoveredAnnotationId) return;
      clearHovered();
      hoveredAnnotationId = id;
      if (id) applyHovered(id);
    }
    el.codeLines.addEventListener('mousemove', function (e) {
      const hit = resolveAnnotationForClick(e.target);
      setHovered(hit ? hit.id : null);
    });
    el.codeLines.addEventListener('mouseleave', function () { setHovered(null); });

    // Clicks anywhere else close the tooltip — but not clicks inside the
    // tooltip itself (so a student can select text inside to copy).
    document.addEventListener('mousedown', function (e) {
      if (el.tooltip.classList.contains('hidden')) return;
      if (el.tooltip.contains(e.target)) return;
      if (el.codeLines.contains(e.target) && resolveAnnotationForClick(e.target)) return;
      closeTooltip();
    });

    window.addEventListener('resize', repositionTooltipIfOpen);
    el.codeView.addEventListener('scroll', function () {
      // While scrolling, re-anchor or hide when the anchor leaves the view.
      if (el.tooltip.classList.contains('hidden')) return;
      repositionTooltipIfOpen();
    }, true);
  }

  function wireSelectionAndModal() {
    el.codeLines.addEventListener('mouseup', onCodeMouseUp);
    // Keyboard selection (shift+arrow) also needs to refresh the button.
    el.codeLines.addEventListener('keyup', onCodeMouseUp);
    document.addEventListener('selectionchange', function () {
      // If selection collapses or moves outside the code view, drop the button.
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        hideCommentButton();
        return;
      }
      const r = sel.getRangeAt(0);
      if (!el.codeLines.contains(r.commonAncestorContainer)) hideCommentButton();
    });
    // Keep the button pinned while the page scrolls/resizes.
    window.addEventListener('resize', repositionButtonIfVisible);
    el.codeView.addEventListener('scroll', repositionButtonIfVisible, true);

    el.commentBtn.addEventListener('mousedown', function (e) {
      // Prevent the click from collapsing the selection before we read it.
      e.preventDefault();
    });
    el.commentBtn.addEventListener('click', function () {
      if (!selectionRange) return;
      const range = selectionRange;
      el.commentBtn.classList.add('hidden');
      selectionRange = null;
      openCommentModal(range);
    });

    el.modalSave.addEventListener('click', saveCommentModal);
    el.modalCancel.addEventListener('click', closeCommentModal);
    el.modalBackdrop.addEventListener('click', function (e) {
      if (e.target === el.modalBackdrop) closeCommentModal();
    });

    el.typeSelector.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'annotation-type') setSelectedType(e.target.value);
    });

    document.querySelectorAll('[data-modal-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { setModalView(btn.dataset.modalView); });
    });

    el.btnAddComment.addEventListener('click', addCommentBlock);
    el.btnDeleteAnnotation.addEventListener('click', deleteEditingAnnotation);

    el.newTagCreate.addEventListener('click', createTagFromForm);
    el.newTagCancel.addEventListener('click', hideNewTagForm);
    el.newTagLabel.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); createTagFromForm(); }
      else if (e.key === 'Escape') { e.preventDefault(); hideNewTagForm(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.tagModalBackdrop.classList.contains('hidden')) { closeTagManager(); return; }
        if (!el.modalBackdrop.classList.contains('hidden')) closeCommentModal();
        if (!el.tooltip.classList.contains('hidden')) closeTooltip();
        hideCommentButton();
      }
    });
  }

  function repositionButtonIfVisible() {
    if (el.commentBtn.classList.contains('hidden')) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideCommentButton(); return; }
    positionCommentButton(sel.getRangeAt(0));
  }

  function insertAtCursor(ta, text) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
  }

  function wireTopbar() {
    el.btnNew.addEventListener('click', function () {
      const ok = window.confirm('Start a new submission? This clears everything.');
      if (!ok) return;
      resetEverything();
    });
    el.btnTags.addEventListener('click', openTagManager);
    el.btnExport.addEventListener('click', function() {
      if (!submission.studentName || !submission.studentName.trim() || !submission.assignmentName || !submission.assignmentName.trim()) {
        alert('Add a student name and assignment name before exporting');
        return;
      }
      if (window.exportSubmission) window.exportSubmission(submission);
    });
    el.tagModalClose.addEventListener('click', closeTagManager);
    el.btnAddTagRow.addEventListener('click', addNewTagRow);
    el.tagModalBackdrop.addEventListener('click', function (e) {
      if (e.target === el.tagModalBackdrop) closeTagManager();
    });
  }

  function resetEverything() {
    Object.assign(submission, newSubmission());
    queue = [submission];
    activeIdx = 0;
    el.studentName.value = '';
    el.assignmentName.value = '';
    el.languageSelect.value = 'python';
    el.scoreEarned.value = '';
    el.scoreTotal.value = '';
    el.overallComment.value = '';
    el.codeInput.value = '';
    setOverallView('edit');
    closeCommentModal();
    closeTooltip();
    hideCommentButton();
    renderAnnotationList();
    renderQueueDrawer();
    updateQueueCounter();
    updateExportAllButton();
    showEmptyView();
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  function init() {
    if (!window.hljs) {
      console.error('highlight.js did not load');
      return;
    }
    wireMetadata();
    wireCodeInput();
    wireSelectionAndModal();
    wireTooltip();
    wireCopyButton();
    wireTopbar();
    wireImport();
    wireQueueDrawer();
    el.initExportButton();
    renderAnnotationList();
    renderQueueDrawer();
    updateQueueCounter();
    updateExportAllButton();
    showEmptyView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
