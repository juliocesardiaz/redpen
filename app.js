/* redpen — author mode logic
 *
 * Build order: currently at Step 1 (skeleton + paste-and-display).
 * Later steps will extend the submission model with annotations, tags, etc.
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
  };

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
      return;
    }
    const lineHtmls = highlightByLines(code, submission.language);
    // Build DOM directly to avoid a giant innerHTML parse pass mid-edit later.
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lineHtmls.length; i++) {
      const row = document.createElement('div');
      row.className = 'line';
      row.dataset.line = String(i + 1);
      const gutter = document.createElement('span');
      gutter.className = 'line-number';
      gutter.textContent = String(i + 1);
      const content = document.createElement('span');
      content.className = 'line-content';
      // Empty lines need a zero-width space so the row keeps its height.
      content.innerHTML = lineHtmls[i] === '' ? '​' : lineHtmls[i];
      row.appendChild(gutter);
      row.appendChild(content);
      frag.appendChild(row);
    }
    el.codeLines.innerHTML = '';
    el.codeLines.appendChild(frag);
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
  // Sidebar (stub for step 1)
  // ------------------------------------------------------------------

  function renderAnnotationList() {
    if (submission.annotations.length === 0) {
      el.annotationList.innerHTML = '<p class="empty-hint">No annotations yet. Select code to add one.</p>';
      return;
    }
    // Populated in later steps.
    el.annotationList.innerHTML = '';
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
