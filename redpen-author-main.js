/* redpen — author mode: wiring + init
 *
 * Last author-mode file to load. Owns the metadata inputs, the overall-comment
 * preview, all DOM event wiring, "New" reset, and init() — which bootstraps
 * the whole app once highlight.js is available. Markdown rendering lives in
 * viewer-runtime.js (window.RedpenShared.renderMarkdown), shared with the
 * exported viewer. See redpen-author-core.js for the shared namespace contract.
 */

(function () {
  'use strict';

  const R = window.Redpen;
  const state = R.state;
  const el = R.el;

  // ------------------------------------------------------------------
  // Metadata inputs
  // ------------------------------------------------------------------

  function wireMetadata() {
    el.studentName.addEventListener('input', function () {
      state.submission.studentName = el.studentName.value;
      R.markDirty();
      R.renderQueueDrawer();
      R.updateQueueCounter();
    });
    el.assignmentName.addEventListener('input', function () {
      state.submission.assignmentName = el.assignmentName.value;
      R.markDirty();
    });
    el.languageSelect.addEventListener('change', function () {
      state.submission.language = el.languageSelect.value;
      R.markDirty();
      // Re-render the code view with the newly selected language if code is
      // already pasted. Annotations would need the same language context, so
      // in later steps consider whether to lock language alongside code.
      if (state.submission.code) R.renderCodeView();
    });
    el.scoreEarned.addEventListener('input', function () {
      const v = el.scoreEarned.value === '' ? null : Number(el.scoreEarned.value);
      state.submission.score.earned = Number.isFinite(v) ? v : null;
      R.markDirty();
    });
    el.scoreTotal.addEventListener('input', function () {
      const v = el.scoreTotal.value === '' ? null : Number(el.scoreTotal.value);
      state.submission.score.total = Number.isFinite(v) ? v : null;
      R.markDirty();
    });
    el.overallComment.addEventListener('input', function () {
      state.submission.overallComment = el.overallComment.value;
      R.markDirty();
      // Live-update the preview when it's currently showing.
      if (state.overallView === 'preview') renderOverallPreview();
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

  function setOverallView(view) {
    state.overallView = view === 'preview' ? 'preview' : 'edit';
    document.querySelectorAll('[data-overall-view]').forEach(function (b) {
      const active = b.dataset.overallView === state.overallView;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (state.overallView === 'preview') {
      renderOverallPreview();
      el.overallComment.classList.add('hidden');
      el.overallPreview.classList.remove('hidden');
    } else {
      el.overallComment.classList.remove('hidden');
      el.overallPreview.classList.add('hidden');
    }
  }

  function renderOverallPreview() {
    const src = state.submission.overallComment || '';
    if (!src.trim()) {
      el.overallPreview.innerHTML = '<p class="empty-hint">Nothing to preview yet.</p>';
      return;
    }
    el.overallPreview.innerHTML = window.RedpenShared.renderMarkdown(src);
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------

  function wireCodeInput() {
    el.btnRender.addEventListener('click', function () {
      if (!R.commitPastedCode(el.codeInput.value)) {
        el.codeInput.focus();
      }
    });

    // Paste handler: let the browser write into the textarea, then auto-render
    // on the next tick. This gives an instant "paste and see it highlighted"
    // feel without needing to click Render.
    el.codeInput.addEventListener('paste', function () {
      setTimeout(function () { R.commitPastedCode(el.codeInput.value); }, 0);
    });

    el.btnEditCode.addEventListener('click', R.returnToEdit);
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
      const hit = R.resolveAnnotationForClick(e.target);
      if (!hit) return;
      e.stopPropagation();
      if (el.tooltip.dataset.annotationId === hit.id && !el.tooltip.classList.contains('hidden')) {
        R.closeTooltip();
        return;
      }
      R.openTooltip(hit.id, hit.anchor);
    });

    // Cross-element hover: a span annotation that crosses hljs token
    // boundaries becomes several sibling <span>s. Rather than relying on
    // :hover (which fires per-element) we track the annotation under the
    // cursor and toggle a .hovered class on every DOM element that shares
    // the id, plus the .line rows for a line-level annotation's full range.
    let hoveredAnnotationId = null;
    function applyHovered(id) {
      const parts = el.codeLines.querySelectorAll('[data-annotation-id="' + R.cssEscape(id) + '"]');
      parts.forEach(function (p) { p.classList.add('hovered'); });
      const a = R.getAnnotationById(id);
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
      const hit = R.resolveAnnotationForClick(e.target);
      setHovered(hit ? hit.id : null);
    });
    el.codeLines.addEventListener('mouseleave', function () { setHovered(null); });

    // Clicks anywhere else close the tooltip — but not clicks inside the
    // tooltip itself (so a student can select text inside to copy).
    document.addEventListener('mousedown', function (e) {
      if (el.tooltip.classList.contains('hidden')) return;
      if (el.tooltip.contains(e.target)) return;
      if (el.codeLines.contains(e.target) && R.resolveAnnotationForClick(e.target)) return;
      R.closeTooltip();
    });

    window.addEventListener('resize', R.repositionTooltipIfOpen);
    el.codeView.addEventListener('scroll', function () {
      // While scrolling, re-anchor or hide when the anchor leaves the view.
      if (el.tooltip.classList.contains('hidden')) return;
      R.repositionTooltipIfOpen();
    }, true);
  }

  function wireSelectionAndModal() {
    el.codeLines.addEventListener('mouseup', R.onCodeMouseUp);
    // Keyboard selection (shift+arrow) also needs to refresh the button.
    el.codeLines.addEventListener('keyup', R.onCodeMouseUp);
    document.addEventListener('selectionchange', function () {
      // If selection collapses or moves outside the code view, drop the button.
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        R.hideCommentButton();
        return;
      }
      const r = sel.getRangeAt(0);
      if (!el.codeLines.contains(r.commonAncestorContainer)) R.hideCommentButton();
    });
    // Keep the button pinned while the page scrolls/resizes.
    window.addEventListener('resize', repositionButtonIfVisible);
    el.codeView.addEventListener('scroll', repositionButtonIfVisible, true);

    el.commentBtn.addEventListener('mousedown', function (e) {
      // Prevent the click from collapsing the selection before we read it.
      e.preventDefault();
    });
    el.commentBtn.addEventListener('click', function () {
      if (!state.selectionRange) return;
      const range = state.selectionRange;
      el.commentBtn.classList.add('hidden');
      state.selectionRange = null;
      R.openCommentModal(range);
    });

    el.modalSave.addEventListener('click', R.saveCommentModal);
    el.modalCancel.addEventListener('click', R.closeCommentModal);
    el.modalBackdrop.addEventListener('click', function (e) {
      if (e.target === el.modalBackdrop) R.closeCommentModal();
    });

    el.typeSelector.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'annotation-type') R.setSelectedType(e.target.value);
    });

    document.querySelectorAll('[data-modal-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { R.setModalView(btn.dataset.modalView); });
    });

    el.btnAddComment.addEventListener('click', R.addCommentBlock);
    el.btnDeleteAnnotation.addEventListener('click', R.deleteEditingAnnotation);

    el.newTagCreate.addEventListener('click', R.createTagFromForm);
    el.newTagCancel.addEventListener('click', R.hideNewTagForm);
    el.newTagLabel.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); R.createTagFromForm(); }
      else if (e.key === 'Escape') { e.preventDefault(); R.hideNewTagForm(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.tagModalBackdrop.classList.contains('hidden')) { R.closeTagManager(); return; }
        if (!el.githubModalBackdrop.classList.contains('hidden')) { R.closeGithubModal(); return; }
        if (!el.modalBackdrop.classList.contains('hidden')) R.closeCommentModal();
        if (!el.tooltip.classList.contains('hidden')) R.closeTooltip();
        R.hideCommentButton();
      }
    });
  }

  function repositionButtonIfVisible() {
    if (el.commentBtn.classList.contains('hidden')) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { R.hideCommentButton(); return; }
    R.positionCommentButton(sel.getRangeAt(0));
  }

  function wireTopbar() {
    el.btnNew.addEventListener('click', function () {
      const ok = window.confirm('Start a new submission? This clears everything.');
      if (!ok) return;
      resetEverything();
    });
    el.btnTags.addEventListener('click', R.openTagManager);
    el.btnExport.addEventListener('click', function() {
      if (!state.submission.studentName || !state.submission.studentName.trim() || !state.submission.assignmentName || !state.submission.assignmentName.trim()) {
        alert('Add a student name and assignment name before exporting');
        return;
      }
      if (window.exportSubmission) window.exportSubmission(state.submission);
    });
    el.tagModalClose.addEventListener('click', R.closeTagManager);
    el.btnAddTagRow.addEventListener('click', R.addNewTagRow);
    el.tagModalBackdrop.addEventListener('click', function (e) {
      if (e.target === el.tagModalBackdrop) R.closeTagManager();
    });
  }

  function resetEverything() {
    Object.assign(state.submission, R.newSubmission());
    state.queue = [state.submission];
    state.activeIdx = 0;
    el.studentName.value = '';
    el.assignmentName.value = '';
    el.languageSelect.value = 'python';
    el.scoreEarned.value = '';
    el.scoreTotal.value = '';
    el.overallComment.value = '';
    el.codeInput.value = '';
    setOverallView('edit');
    R.closeCommentModal();
    R.closeTooltip();
    R.hideCommentButton();
    R.renderAnnotationList();
    R.renderQueueDrawer();
    R.updateQueueCounter();
    R.updateExportAllButton();
    R.showEmptyView();
    R.clearAutosaveDraft();
    R.resetAutosaveTimers();
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
    R.wireImport();
    R.wireQueueDrawer();
    R.wireAutosave();
    el.initExportButton();
    R.renderAnnotationList();
    R.renderQueueDrawer();
    R.updateQueueCounter();
    R.updateExportAllButton();
    R.showEmptyView();
  }

  R.setOverallView = setOverallView;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
