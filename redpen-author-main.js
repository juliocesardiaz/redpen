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
      // Only the active entry's label can change here — skip rebuilding the
      // whole drawer list on every keystroke.
      R.updateActiveQueueLabel();
    });
    el.assignmentName.addEventListener('input', function () {
      state.submission.assignmentName = el.assignmentName.value;
      R.markDirty();
    });
    el.languageSelect.addEventListener('change', function () {
      state.submission.language = el.languageSelect.value;
      R.markDirty();
      // Re-render the code view with the newly selected language if code is
      // already pasted.
      if (state.submission.code) R.renderCodeView();
    });
    [[el.scoreEarned, 'earned'], [el.scoreTotal, 'total']].forEach(function (pair) {
      const input = pair[0], key = pair[1];
      input.addEventListener('input', function () {
        const v = input.value === '' ? null : Number(input.value);
        state.submission.score[key] = Number.isFinite(v) ? v : null;
        R.markDirty();
      });
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
    R.selectToggle('data-overall-view', state.overallView);
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

  function wireEmptyState() {
    el.btnEmptyGithub.addEventListener('click', R.openGithubModal);

    // Drag & drop import. Scoped to the empty panel so a stray drop can't
    // dump files into an in-progress grading session.
    const zone = el.codeEmpty;
    let dragDepth = 0; // enter/leave fire per child element; track nesting
    zone.addEventListener('dragenter', function (e) {
      e.preventDefault();
      dragDepth++;
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); });
    zone.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', async function (e) {
      e.preventDefault();
      dragDepth = 0;
      zone.classList.remove('dragover');
      let files;
      try {
        files = await collectDroppedFiles(e.dataTransfer);
      } catch (err) {
        console.warn('redpen: reading dropped items failed', err);
        return;
      }
      if (files.length) await R.importFolder(files);
    });
  }

  // Dropped folders arrive as directory entries that must be walked
  // recursively (readEntries returns results in batches until empty); plain
  // files come straight off dataTransfer.files. webkitGetAsEntry is the only
  // cross-browser way to tell the two apart.
  async function collectDroppedFiles(dt) {
    const entries = Array.from(dt.items || [])
      .map(function (item) { return item.webkitGetAsEntry ? item.webkitGetAsEntry() : null; })
      .filter(Boolean);
    if (!entries.length) return Array.from(dt.files || []);
    const out = [];
    async function walk(entry) {
      if (entry.isFile) {
        out.push(await new Promise(function (res, rej) { entry.file(res, rej); }));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise(function (res, rej) { reader.readEntries(res, rej); });
          for (const child of batch) await walk(child);
        } while (batch.length);
      }
    }
    for (const entry of entries) await walk(entry);
    return out;
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
    // boundaries becomes several sibling <span>s. The shared helper tracks
    // the annotation under the cursor and toggles .hovered on every element
    // that shares its id (same behaviour as the exported viewer).
    window.RedpenShared.wireHoverSync(el.codeLines, R.getAnnotationById);

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
    R.wireBackdropClose(el.modalBackdrop, R.closeCommentModal);

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
    R.wireBackdropClose(el.tagModalBackdrop, R.closeTagManager);
  }

  function resetEverything() {
    Object.assign(state.submission, R.newSubmission());
    state.queue = [state.submission];
    state.activeIdx = 0;
    R.closeCommentModal();
    R.closeTooltip();
    R.hideCommentButton();
    // Repopulates every metadata input and the code view from the fresh
    // submission — the same path queue switching uses.
    R.loadSubmissionIntoUI();
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
    wireEmptyState();
    wireSelectionAndModal();
    wireTooltip();
    // Covers every rendered code block (tooltip, overall preview, comment
    // modal preview) — the viewer's own call is behind the #submission-data
    // guard and never runs here.
    window.RedpenShared.wireCopyButtons();
    wireTopbar();
    R.wireImport();
    R.wireGithubImport();
    R.wireQueueDrawer();
    R.wireAutosave();
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
