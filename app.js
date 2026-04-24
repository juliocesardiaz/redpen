/* redpen — author mode logic
 *
 * Build order: currently at Step 5 (tags).
 * Later steps will extend with markdown, export, viewer polish.
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

  // Tighter escape for attribute values built via string concatenation.
  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
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
        const style = tag ? ' style="--hl:' + escapeAttr(tag.color) + '"' : '';
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
    renderTagChips();
    renderCommentBlocks();
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
      return { id: c.id, text: c.text, createdAt: c.createdAt };
    });
    if (editingBlocks.length === 0) editingBlocks = [blankBlock()];
    editingTagIds = (a.tagIds || []).slice();
    el.modalTitle.textContent = 'Edit annotation';
    el.modalRange.textContent = formatRangeLabel(a.range);
    setSelectedType(a.type);
    el.btnDeleteAnnotation.classList.remove('hidden');
    hideNewTagForm();
    renderTagChips();
    renderCommentBlocks();
    el.modalBackdrop.classList.remove('hidden');
    setTimeout(function () { focusFirstBlockTextarea(); }, 0);
  }

  function blankBlock() {
    return { id: null, text: '', createdAt: null };
  }

  function focusFirstBlockTextarea() {
    const ta = el.commentBlocks.querySelector('textarea');
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
      ? 'Write a comment (plain text for now; markdown arrives in step 7)'
      : 'Additional comment…';
    ta.addEventListener('input', function () {
      editingBlocks[index].text = ta.value;
    });
    ta.addEventListener('keydown', handleModalTextareaKey);
    row.appendChild(ta);

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
      });
      row.appendChild(del);
    }
    return row;
  }

  function addCommentBlock() {
    editingBlocks.push(blankBlock());
    renderCommentBlocks();
    const all = el.commentBlocks.querySelectorAll('textarea');
    const last = all[all.length - 1];
    if (last) last.focus();
  }

  function handleModalTextareaKey(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      insertAtCursor(e.currentTarget, '  ');
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveCommentModal();
    }
  }

  function saveCommentModal() {
    // Collect non-empty blocks in order, preserving ids/createdAts where they
    // already exist so the sidebar's "edit" round-trip doesn't churn metadata.
    const now = Date.now();
    const kept = [];
    for (const b of editingBlocks) {
      const text = b.text.trim();
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
    // Step 5: tag pills + plain-text comments. Step 7 swaps plain text for
    // rendered markdown.
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
      body.className = 'tooltip-comment';
      body.textContent = annotation.comments[i].text;
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
    el.tagModalClose.addEventListener('click', closeTagManager);
    el.btnAddTagRow.addEventListener('click', addNewTagRow);
    el.tagModalBackdrop.addEventListener('click', function (e) {
      if (e.target === el.tagModalBackdrop) closeTagManager();
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
    closeTooltip();
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
    wireTooltip();
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
