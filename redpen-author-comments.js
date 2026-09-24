/* redpen — author mode: annotations
 *
 * The annotation lifecycle: turning a code selection into source coordinates,
 * the floating "+ Comment" button, the comment editor modal (including the
 * diff-suggestion drafting UI), the read-only tooltip, and the sidebar list.
 * See redpen-author-core.js for the shared namespace contract.
 */

(function () {
  'use strict';

  const R = window.Redpen;
  const state = R.state;
  const el = R.el;

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
    const len = state.sourceLines[line - 1] ? state.sourceLines[line - 1].length : 0;
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
    state.selectionRange = coords;
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
    state.selectionRange = null;
  }

  // ------------------------------------------------------------------
  // Comment editor modal
  // ------------------------------------------------------------------

  // Shared tail of both modal-open paths: header text, type radio, delete
  // button visibility, then the full redraw + open + focus. Draft state
  // (editingRange / editingBlocks / editingTagIds) is set by the caller first.
  function presentCommentModal(title, range, type, canDelete) {
    el.modalTitle.textContent = title;
    el.modalRange.textContent = formatRangeLabel(range);
    setSelectedType(type);
    el.btnDeleteAnnotation.classList.toggle('hidden', !canDelete);
    R.hideNewTagForm();
    R.hideSnippetPicker();
    setModalView('edit');
    R.renderTagChips();
    renderCommentBlocks();
    updateSaveButton();
    el.modalBackdrop.classList.remove('hidden');
    setTimeout(function () { focusFirstBlockTextarea(); }, 0);
  }

  function openCommentModal(range) {
    if (!range) return;
    state.editingAnnotationId = null;
    state.editingRange = range;
    state.editingBlocks = [blankBlock()];
    state.editingTagIds = [];
    // Auto-suggest the type: single line → span, multi-line → line range.
    // Block is always manual — the teacher opts into it when they want the
    // left-border treatment for a structured region.
    const suggested = range.startLine === range.endLine ? 'span' : 'line-range';
    presentCommentModal('Add comment', range, suggested, false);
  }

  function openCommentModalForEdit(annotationId) {
    const a = R.getAnnotationById(annotationId);
    if (!a) return;
    closeTooltip();
    state.editingAnnotationId = a.id;
    state.editingRange = Object.assign({}, a.range);
    state.editingBlocks = a.comments.map(function (c) {
      return { id: c.id, text: c.text, createdAt: c.createdAt, diff: newDiffState() };
    });
    if (state.editingBlocks.length === 0) state.editingBlocks = [blankBlock()];
    state.editingTagIds = (a.tagIds || []).slice();
    presentCommentModal('Edit annotation', a.range, a.type, true);
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
    R.hideNewTagForm();
    R.hideSnippetPicker();
    state.editingRange = null;
    state.editingAnnotationId = null;
    state.editingBlocks = [];
    state.editingTagIds = [];
  }

  function renderCommentBlocks() {
    el.commentBlocks.innerHTML = '';
    for (let i = 0; i < state.editingBlocks.length; i++) {
      el.commentBlocks.appendChild(buildCommentBlock(i));
    }
  }

  function buildCommentBlock(index) {
    const block = state.editingBlocks[index];
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
      state.editingBlocks[index].text = ta.value;
      if (state.modalView !== 'edit') updateBlockPreview(index);
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
    if (state.editingBlocks.length > 1) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'comment-block-delete';
      del.title = 'Remove this comment';
      del.setAttribute('aria-label', 'Remove this comment');
      del.textContent = '×';
      del.addEventListener('click', function () {
        state.editingBlocks.splice(index, 1);
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
    const block = state.editingBlocks[index];
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
      state.editingBlocks[index].diff[which] = ta.value;
      if (state.modalView !== 'edit') updateBlockPreview(index);
      updateSaveButton();
    });
    ta.addEventListener('keydown', handleDiffFieldKey);
    wrap.appendChild(ta);

    label.htmlFor = ta.id = 'diff-' + which + '-' + index;
    return wrap;
  }

  function toggleDiffSuggestion(index) {
    const block = state.editingBlocks[index];
    if (!block.diff.expanded) {
      // First-expand: pre-fill Before from the annotation's source text using
      // the currently-selected type so span shows the substring and
      // line-range / block show the full affected lines.
      block.diff.expanded = true;
      block.diff.before = getAnnotationSourceText(state.editingRange, getSelectedType());
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
    if (state.modalView !== 'edit') updateBlockPreview(index);
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
      setModalView(state.modalView === 'edit' ? 'preview' : 'edit');
    }
  }

  function getAnnotationSourceText(range, type) {
    if (!range || !state.sourceLines.length) return '';
    const start = Math.max(0, range.startLine - 1);
    const end = Math.min(state.sourceLines.length - 1, range.endLine - 1);
    if (type === 'span') {
      if (start === end) {
        const line = state.sourceLines[start] || '';
        return line.substring(
          typeof range.startCol === 'number' ? range.startCol : 0,
          typeof range.endCol === 'number' ? range.endCol : line.length
        );
      }
      // Multi-line span: start col → end of first line, full middle lines,
      // start → endCol on last line.
      const first = state.sourceLines[start] || '';
      const last = state.sourceLines[end] || '';
      const parts = [first.substring(typeof range.startCol === 'number' ? range.startCol : 0)];
      for (let i = start + 1; i < end; i++) parts.push(state.sourceLines[i] || '');
      parts.push(last.substring(0, typeof range.endCol === 'number' ? range.endCol : last.length));
      return parts.join('\n');
    }
    // line-range / block: full affected lines, indentation preserved.
    const lines = [];
    for (let i = start; i <= end; i++) lines.push(state.sourceLines[i] || '');
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
    const canSave = state.editingBlocks.some(function (b) { return !!buildCommentFinalText(b); });
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
    preview.innerHTML = renderOrEmpty(buildCommentFinalText(state.editingBlocks[index]));
  }

  function setModalView(view) {
    state.modalView = view === 'preview' || view === 'split' ? view : 'edit';
    el.commentBlocks.dataset.view = state.modalView;
    R.selectToggle('data-modal-view', state.modalView);
    if (state.modalView !== 'edit') {
      for (let i = 0; i < state.editingBlocks.length; i++) updateBlockPreview(i);
    }
  }

  function addCommentBlock() {
    state.editingBlocks.push(blankBlock());
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
      setModalView(state.modalView === 'edit' ? 'preview' : 'edit');
    }
  }

  function insertAtCursor(ta, text) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
  }

  function saveCommentModal() {
    // Collect non-empty blocks in order, preserving ids/createdAts where they
    // already exist so the sidebar's "edit" round-trip doesn't churn metadata.
    // Each block's text is its textarea body plus an optional generated
    // ```diff fence built from the UI-only diff-suggestion draft state.
    const now = Date.now();
    const kept = [];
    for (const b of state.editingBlocks) {
      const text = buildCommentFinalText(b);
      if (!text) continue;
      kept.push({
        id: b.id || R.uuid(),
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
    const tagIds = state.editingTagIds.filter(function (id) { return !!R.getTagById(id); });

    if (state.editingAnnotationId === null) {
      if (!state.editingRange) { closeCommentModal(); return; }
      const range = { startLine: state.editingRange.startLine, endLine: state.editingRange.endLine };
      if (type === 'span') {
        range.startCol = state.editingRange.startCol;
        range.endCol = state.editingRange.endCol;
      }
      state.submission.annotations.push({
        id: R.uuid(),
        type: type,
        range: range,
        comments: kept,
        tagIds: tagIds,
      });
    } else {
      const a = R.getAnnotationById(state.editingAnnotationId);
      if (!a) { closeCommentModal(); return; }
      a.type = type;
      if (type === 'span') {
        // If switching to span from a whole-line type, default cols to the
        // full first line so the highlight still visibly lands somewhere.
        if (typeof a.range.startCol !== 'number') a.range.startCol = 0;
        if (typeof a.range.endCol !== 'number') {
          const ln = (state.sourceLines[a.range.startLine - 1] || '').length;
          a.range.endCol = ln;
        }
      } else {
        delete a.range.startCol;
        delete a.range.endCol;
      }
      a.comments = kept;
      a.tagIds = tagIds;
    }

    closeCommentModal();
    closeTooltip();
    hideCommentButton();
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    commitAnnotationsChange();
  }

  // Every annotation mutation ends the same way: persist, re-render the code
  // view (wrappers may have changed), refresh the sidebar, and update the
  // lock/edit toolbar state.
  function commitAnnotationsChange() {
    R.markDirty();
    R.renderCodeView();
    renderAnnotationList();
    R.updateToolbarStatus();
  }

  function deleteEditingAnnotation() {
    if (state.editingAnnotationId === null) return;
    const ok = window.confirm('Delete this annotation and all its comments?');
    if (!ok) return;
    const id = state.editingAnnotationId;
    state.submission.annotations = state.submission.annotations.filter(function (a) { return a.id !== id; });
    closeCommentModal();
    closeTooltip();
    commitAnnotationsChange();
  }

  function deleteAnnotationById(id) {
    const ok = window.confirm('Delete this annotation?');
    if (!ok) return;
    state.submission.annotations = state.submission.annotations.filter(function (a) { return a.id !== id; });
    if (el.tooltip.dataset.annotationId === id) closeTooltip();
    commitAnnotationsChange();
  }

  function formatRangeLabel(r) {
    if (r.startLine === r.endLine) {
      if (typeof r.startCol === 'number' && typeof r.endCol === 'number' &&
          !(r.startCol === 0 && r.endCol >= (state.sourceLines[r.startLine - 1] || '').length)) {
        return 'L' + r.startLine + ':' + r.startCol + '–' + r.endCol;
      }
      return 'L' + r.startLine;
    }
    return 'L' + r.startLine + '–L' + r.endLine;
  }

  // ------------------------------------------------------------------
  // Tooltip (single instance; repositioned + repopulated per open)
  // ------------------------------------------------------------------

  function resolveAnnotationForClick(target) {
    return window.RedpenShared.resolveAnnotationFromTarget(target, el.codeLines);
  }

  function openTooltip(annotationId, anchorEl) {
    const annotation = R.getAnnotationById(annotationId);
    if (!annotation || !anchorEl) return;
    renderTooltipContent(annotation);
    el.tooltip.dataset.annotationId = annotationId;
    el.tooltip.classList.remove('hidden');
    window.RedpenShared.positionTooltip(el.tooltip, anchorEl);
  }

  function closeTooltip() {
    el.tooltip.classList.add('hidden');
    el.tooltip.dataset.annotationId = '';
  }

  // Author-mode tag pill: CSS-variable driven, unlike the viewer's inline
  // colors. `small` picks the sidebar's compact variant.
  function makeTagPill(t, small) {
    const pill = document.createElement('span');
    pill.className = small ? 'tag-pill tag-pill-sm' : 'tag-pill';
    pill.style.setProperty('--tag-color', t.color);
    pill.textContent = t.label;
    return pill;
  }

  function renderTooltipContent(annotation) {
    window.RedpenShared.renderTooltipContent(
      el.tooltipContent, annotation, R.getTagById,
      function (t) { return makeTagPill(t, false); }
    );
  }

  function repositionTooltipIfOpen() {
    if (el.tooltip.classList.contains('hidden')) return;
    const id = el.tooltip.dataset.annotationId;
    if (!id) return;
    // Re-anchor on the first span that still matches this annotation id.
    const anchor = el.codeLines.querySelector('[data-annotation-id="' + R.cssEscape(id) + '"]');
    if (!anchor) { closeTooltip(); return; }
    window.RedpenShared.positionTooltip(el.tooltip, anchor);
  }

  // ------------------------------------------------------------------
  // Sidebar annotation list
  // ------------------------------------------------------------------

  function renderAnnotationList() {
    // Refresh the queue drawer dot indicator alongside the right sidebar list,
    // since both reflect annotations.length for the active submission.
    if (el.queueList) R.renderQueueDrawer();
    el.annotationList.innerHTML = '';
    if (state.submission.annotations.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = 'No annotations yet. Select code to add one.';
      el.annotationList.appendChild(hint);
      return;
    }
    const sorted = state.submission.annotations.slice().sort(function (a, b) {
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
        const t = R.getTagById(id);
        if (t) pills.appendChild(makeTagPill(t, true));
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
    const span = el.codeLines.querySelector('[data-annotation-id="' + R.cssEscape(id) + '"]');
    if (!span) return;
    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    span.classList.add('flash');
    setTimeout(function () { span.classList.remove('flash'); }, 900);
  }

  R.onCodeMouseUp = onCodeMouseUp;
  R.positionCommentButton = positionCommentButton;
  R.hideCommentButton = hideCommentButton;
  R.openCommentModal = openCommentModal;
  R.closeCommentModal = closeCommentModal;
  R.setSelectedType = setSelectedType;
  R.setModalView = setModalView;
  R.addCommentBlock = addCommentBlock;
  R.saveCommentModal = saveCommentModal;
  R.deleteEditingAnnotation = deleteEditingAnnotation;
  R.resolveAnnotationForClick = resolveAnnotationForClick;
  R.openTooltip = openTooltip;
  R.closeTooltip = closeTooltip;
  R.repositionTooltipIfOpen = repositionTooltipIfOpen;
  R.renderAnnotationList = renderAnnotationList;
})();
