/* redpen — author mode logic
 *
 * Build order: currently at Step 3 (span + line-range + block types).
 * Later steps will extend with tooltip, tags, markdown, export.
 */

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  /** @type {Submission} */
  const submission = newSubmission();

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
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
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
    btnNew: document.getElementById('btn-new'),
    codeEmpty: document.getElementById('code-empty'),
    codeInput: document.getElementById('code-input'),
    btnRender: document.getElementById('btn-render'),
    codeView: document.getElementById('code-view'),
    codeLines: document.getElementById('code-lines'),
    codeToolbarStatus: document.getElementById('code-toolbar-status'),
    btnEditCode: document.getElementById('btn-edit-code'),
    overallComment: document.getElementById('overall-comment'),
    annotationList: document.getElementById('annotation-list'),
    commentBtn: document.getElementById('comment-btn'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modal: document.getElementById('comment-modal'),
    modalRange: document.getElementById('modal-range'),
    modalTextarea: document.getElementById('modal-textarea'),
    modalSave: document.getElementById('modal-save'),
    modalCancel: document.getElementById('modal-cancel'),
    typeSelector: document.getElementById('type-selector'),
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
      html = escapeHtml(source);
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

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
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
    // since inner DOM elements receive the event first. Array.sort is
    // stable, so equal-width annotations keep insertion order.
    const annotationsByLine = indexAnnotationsByLine(submission.annotations, sourceLines.length);

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
      wraps.sort(function (x, y) { return y.width - x.width; });

      let hasLineRange = false;
      let hasBlock = false;
      for (const w of wraps) {
        const a = w.annotation;
        if (a.type === 'line-range') hasLineRange = true;
        if (a.type === 'block') hasBlock = true;
        const openTag = '<span class="annotation annotation-' + a.type + '" data-annotation-id="' + a.id + '">';
        lineHtml = wrapColumnRange(lineHtml, w.startCol, w.endCol, openTag, '</span>');
      }

      const row = document.createElement('div');
      row.className = 'line';
      if (hasLineRange) row.classList.add('has-line-range');
      if (hasBlock) row.classList.add('has-block');
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
    el.codeInput.value = submission.code;
    submission.code = '';
    submission.updatedAt = Date.now();
    showEmptyView();
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
    const rect = range.getBoundingClientRect();
    const btn = el.commentBtn;
    // Park offscreen before unhiding so we can measure without a visible flash
    // at the previous coords.
    btn.style.left = '-9999px';
    btn.style.top = '-9999px';
    btn.classList.remove('hidden');
    const w = btn.offsetWidth;
    let left = rect.right + 6;
    let top = rect.top - 4;
    if (top < 8) top = rect.bottom + 6;
    const maxLeft = window.innerWidth - w - 8;
    if (left > maxLeft) left = Math.max(8, rect.left - w - 6);
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
    editingRange = range;
    el.modalRange.textContent = formatRangeLabel(range);
    el.modalTextarea.value = '';
    // Auto-suggest the type: single line → span, multi-line → line range.
    // Block is always manual — the teacher opts into it when they want the
    // left-border treatment for a structured region.
    const suggested = range.startLine === range.endLine ? 'span' : 'line-range';
    setSelectedType(suggested);
    el.modalBackdrop.classList.remove('hidden');
    // Delay focus so the transition plays and the textarea actually receives it.
    setTimeout(function () { el.modalTextarea.focus(); }, 0);
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
    editingRange = null;
  }

  function saveCommentModal() {
    const text = el.modalTextarea.value.trim();
    if (!text) {
      el.modalTextarea.focus();
      return;
    }
    if (!editingRange) { closeCommentModal(); return; }
    const now = Date.now();
    const type = getSelectedType();
    // Line-range and block are whole-line; they don't carry column offsets.
    // Span keeps columns. This matches the data-model rule in the spec.
    const range = { startLine: editingRange.startLine, endLine: editingRange.endLine };
    if (type === 'span') {
      range.startCol = editingRange.startCol;
      range.endCol = editingRange.endCol;
    }
    const annotation = {
      id: uuid(),
      type: type,
      range: range,
      comments: [{ id: uuid(), text: text, createdAt: now }],
      tagIds: [],
    };
    submission.annotations.push(annotation);
    submission.updatedAt = now;
    closeCommentModal();
    hideCommentButton();
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
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
  // Sidebar annotation list
  // ------------------------------------------------------------------

  function renderAnnotationList() {
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
    for (const a of sorted) {
      const firstText = a.comments[0] ? a.comments[0].text : '';
      const preview = firstText.length > 80 ? firstText.substring(0, 80) + '…' : firstText;
      const item = document.createElement('div');
      item.className = 'annotation-item';
      item.dataset.annotationId = a.id;
      item.innerHTML =
        '<div class="annotation-item-head"><span class="annotation-range">' +
        escapeHtml(formatRangeLabel(a.range)) +
        '</span><span class="annotation-type">' + a.type + '</span></div>' +
        '<div class="annotation-preview">' + escapeHtml(preview) + '</div>';
      item.addEventListener('click', function () { scrollToAnnotation(a.id); });
      el.annotationList.appendChild(item);
    }
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
    });
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

    // Tab-to-indent inside the comment textarea. Shift+Tab dedents or escapes.
    el.modalTextarea.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        insertAtCursor(el.modalTextarea, '  ');
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveCommentModal();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.modalBackdrop.classList.contains('hidden')) closeCommentModal();
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
  }

  function resetEverything() {
    Object.assign(submission, newSubmission());
    el.studentName.value = '';
    el.assignmentName.value = '';
    el.languageSelect.value = 'python';
    el.scoreEarned.value = '';
    el.scoreTotal.value = '';
    el.overallComment.value = '';
    el.codeInput.value = '';
    closeCommentModal();
    hideCommentButton();
    renderAnnotationList();
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
    wireTopbar();
    renderAnnotationList();
    showEmptyView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
