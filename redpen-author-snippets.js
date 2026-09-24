/* redpen — author mode: comment snippet library
 *
 * Reusable comments the teacher builds up over time: the "Snippets" manager
 * modal (edit / delete / import from a Markdown file) and the "+ Insert
 * snippet" picker inside the comment editor. Snippets are app-level, not part
 * of any submission — they persist in localStorage (same precedent as
 * autosave) and are never exported. See redpen-author-core.js for the shared
 * namespace contract.
 */

(function () {
  'use strict';

  const R = window.Redpen;
  const el = R.el;

  const SNIPPETS_KEY = 'redpen.snippets.v1';

  // Only this file touches the library, so it can stay module-scoped —
  // unlike R.state, no other module needs to see it.
  let snippets = loadSnippets();

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  function loadSnippets() {
    let raw;
    try { raw = localStorage.getItem(SNIPPETS_KEY); } catch (_) { return []; }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.snippets)) return [];
      // Defensive normalize, mirroring the autosave restore path. Text-less
      // entries are dropped: a snippet with nothing to insert is useless.
      return parsed.snippets
        .filter(function (s) { return s && typeof s.text === 'string' && s.text.trim(); })
        .map(function (s) {
          return {
            id: typeof s.id === 'string' ? s.id : R.uuid(),
            title: typeof s.title === 'string' ? s.title : '',
            text: s.text,
            createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
          };
        });
    } catch (_) {
      return [];
    }
  }

  function saveSnippets() {
    try {
      localStorage.setItem(SNIPPETS_KEY, JSON.stringify({ version: 1, snippets: snippets }));
      return true;
    } catch (e) {
      console.warn('redpen snippets: save failed', e);
      setImportStatus('Couldn’t save snippets — browser storage may be full.');
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Markdown import
  // ------------------------------------------------------------------

  /**
   * Parse a Markdown file into {title, text} snippet candidates. Three file
   * shapes, tried in order:
   *   1. Headings: each heading starts a snippet — heading text is the title,
   *      everything until the next heading is the snippet body. Headings with
   *      an empty body (e.g. a document-title `# My comments` immediately
   *      followed by `##` sections) are skipped.
   *   2. No headings but top-level bullets: one snippet per bullet; indented
   *      continuation lines stay attached to their bullet.
   *   3. Otherwise: one snippet per blank-line-separated paragraph.
   * Lines inside ``` / ~~~ fences never start or split a snippet, so code
   * examples with `#` lines or blank lines survive intact.
   */
  function parseSnippetsMarkdown(md) {
    const rawLines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    let inFence = false;
    const lines = rawLines.map(function (line) {
      const fenceEdge = /^\s*(```|~~~)/.test(line);
      const rec = { text: line, inFence: inFence || fenceEdge };
      if (fenceEdge) inFence = !inFence;
      return rec;
    });
    const isHeading = function (l) { return !l.inFence && /^#{1,6}\s+\S/.test(l.text); };
    const isBullet = function (l) { return !l.inFence && /^[-*+]\s+\S/.test(l.text); };

    const out = [];
    const push = function (title, body) {
      while (body.length && !body[0].trim()) body.shift();
      while (body.length && !body[body.length - 1].trim()) body.pop();
      const text = body.join('\n');
      if (!text) return;
      out.push({ title: title || titleFromText(text), text: text });
    };

    if (lines.some(isHeading)) {
      let title = null;
      let body = [];
      let started = false; // content before the first heading is preamble — ignore it
      for (const l of lines) {
        if (isHeading(l)) {
          if (started) push(title, body);
          started = true;
          title = l.text.replace(/^#{1,6}\s+/, '').replace(/\s*#+\s*$/, '').trim();
          body = [];
        } else if (started) {
          body.push(l.text);
        }
      }
      if (started) push(title, body);
      return out;
    }

    if (lines.some(isBullet)) {
      let body = null;
      for (const l of lines) {
        if (isBullet(l)) {
          if (body) push(null, body);
          body = [l.text.replace(/^[-*+]\s+/, '')];
        } else if (body) {
          if (!l.inFence && !l.text.trim()) { push(null, body); body = null; }
          else body.push(l.text.replace(/^ {2,4}/, ''));
        }
      }
      if (body) push(null, body);
      return out;
    }

    let body = [];
    for (const l of lines) {
      if (!l.inFence && !l.text.trim()) { push(null, body); body = []; }
      else body.push(l.text);
    }
    push(null, body);
    return out;
  }

  function titleFromText(text) {
    const first = text.split('\n').find(function (l) { return l.trim(); }) || '';
    const plain = first.replace(/^[#>\-*+\s`]+/, '').trim() || 'Snippet';
    return plain.length > 60 ? plain.slice(0, 57) + '…' : plain;
  }

  async function handleSnippetFile() {
    const file = el.snippetMdInput.files && el.snippetMdInput.files[0];
    el.snippetMdInput.value = ''; // allow re-picking the same file
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch (e) {
      console.warn('redpen snippets: reading file failed', e);
      setImportStatus('Couldn’t read ' + file.name + '.');
      return;
    }
    importParsed(parseSnippetsMarkdown(text), file.name);
  }

  function importParsed(parsed, filename) {
    if (!parsed.length) {
      setImportStatus('No snippets found in ' + filename + ' — see the format note above.');
      return;
    }
    // Dedupe on snippet text so re-importing the same file is a no-op instead
    // of doubling the library.
    const seen = new Set(snippets.map(function (s) { return s.text.trim(); }));
    let added = 0;
    let skipped = 0;
    for (const p of parsed) {
      const key = p.text.trim();
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      snippets.push({ id: R.uuid(), title: p.title, text: p.text, createdAt: Date.now() });
      added++;
    }
    if (added && !saveSnippets()) return; // saveSnippets already set the status
    renderSnippetRows();
    if (!added) {
      setImportStatus('Nothing new — every snippet in the file is already in the library.');
    } else {
      setImportStatus(
        'Imported ' + added + (added === 1 ? ' snippet' : ' snippets') +
        (skipped ? ' (' + skipped + ' duplicate' + (skipped === 1 ? '' : 's') + ' skipped)' : '') + '.'
      );
    }
  }

  function setImportStatus(msg) {
    el.snippetImportStatus.textContent = msg;
  }

  // ------------------------------------------------------------------
  // Snippet manager modal
  // ------------------------------------------------------------------

  function openSnippetManager() {
    setImportStatus('');
    renderSnippetRows();
    el.snippetModalBackdrop.classList.remove('hidden');
    setTimeout(function () {
      const first = el.snippetRows.querySelector('.snippet-title-input');
      if (first) first.focus();
    }, 0);
  }

  function closeSnippetManager() {
    el.snippetModalBackdrop.classList.add('hidden');
    // The picker may be open underneath (manager reached via "Manage
    // snippets…" from the comment editor) — refresh it so edits show up.
    if (!el.snippetPicker.classList.contains('hidden')) renderSnippetPickerList();
  }

  function renderSnippetRows() {
    el.snippetRows.innerHTML = '';
    if (snippets.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = 'No snippets yet — add one below or import a Markdown file.';
      el.snippetRows.appendChild(hint);
      return;
    }
    for (const s of snippets) el.snippetRows.appendChild(buildSnippetRow(s));
  }

  function buildSnippetRow(sn) {
    const row = document.createElement('div');
    row.className = 'snippet-row';
    row.dataset.snippetId = sn.id;

    const head = document.createElement('div');
    head.className = 'snippet-row-head';

    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'snippet-title-input';
    title.value = sn.title;
    title.placeholder = 'Title';
    title.maxLength = 80;
    title.setAttribute('aria-label', 'Snippet title');
    title.addEventListener('input', function () {
      sn.title = title.value;
      saveSnippets();
    });
    head.appendChild(title);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tag-delete';
    del.title = 'Delete snippet';
    del.setAttribute('aria-label', 'Delete snippet ' + (sn.title || ''));
    del.textContent = '×';
    del.addEventListener('click', function () { deleteSnippet(sn.id); });
    head.appendChild(del);

    row.appendChild(head);

    const ta = document.createElement('textarea');
    ta.className = 'snippet-text-input';
    ta.value = sn.text;
    ta.rows = 3;
    ta.spellcheck = false;
    ta.setAttribute('autocomplete', 'off');
    ta.placeholder = 'Snippet text. Markdown supported.';
    ta.setAttribute('aria-label', 'Snippet text');
    ta.addEventListener('input', function () {
      sn.text = ta.value;
      saveSnippets();
    });
    row.appendChild(ta);
    return row;
  }

  function deleteSnippet(id) {
    if (!window.confirm('Delete this snippet?')) return;
    snippets = snippets.filter(function (s) { return s.id !== id; });
    saveSnippets();
    renderSnippetRows();
  }

  function addNewSnippetRow() {
    const sn = { id: R.uuid(), title: '', text: '', createdAt: Date.now() };
    snippets.push(sn);
    saveSnippets();
    renderSnippetRows();
    const title = el.snippetRows.querySelector(
      '[data-snippet-id="' + R.cssEscape(sn.id) + '"] .snippet-title-input'
    );
    if (title) title.focus();
  }

  // ------------------------------------------------------------------
  // Picker inside the comment editor modal
  // ------------------------------------------------------------------

  // Which comment textarea to insert into. "+ Insert snippet" steals focus,
  // so remember the last-focused block by index (not element — the blocks are
  // rebuilt wholesale on re-render, which would strand an element ref).
  let lastBlockIdx = 0;

  function toggleSnippetPicker() {
    if (el.snippetPicker.classList.contains('hidden')) {
      el.snippetPickerFilter.value = '';
      renderSnippetPickerList();
      el.snippetPicker.classList.remove('hidden');
      el.snippetPickerFilter.focus();
    } else {
      hideSnippetPicker();
    }
  }

  /** Hide the picker; returns whether it was open. main.js's Escape handler
   *  uses the return value to close just the picker, not the whole modal. */
  function hideSnippetPicker() {
    const wasOpen = !el.snippetPicker.classList.contains('hidden');
    el.snippetPicker.classList.add('hidden');
    return wasOpen;
  }

  function renderSnippetPickerList() {
    const q = el.snippetPickerFilter.value.trim().toLowerCase();
    el.snippetPickerList.innerHTML = '';
    const matches = snippets.filter(function (s) {
      if (!s.text.trim()) return false; // manager rows still being typed
      return !q || s.title.toLowerCase().indexOf(q) !== -1 ||
        s.text.toLowerCase().indexOf(q) !== -1;
    });
    if (!matches.length) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = snippets.length
        ? 'No snippets match.'
        : 'No snippets yet — use “Manage snippets…” to write or import some.';
      el.snippetPickerList.appendChild(hint);
      return;
    }
    for (const s of matches) el.snippetPickerList.appendChild(buildPickerItem(s));
  }

  function buildPickerItem(sn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'snippet-pick';
    const title = document.createElement('span');
    title.className = 'snippet-pick-title';
    title.textContent = sn.title || titleFromText(sn.text);
    btn.appendChild(title);
    const preview = document.createElement('span');
    preview.className = 'snippet-pick-preview';
    preview.textContent = sn.text.replace(/\s+/g, ' ').slice(0, 90);
    btn.appendChild(preview);
    btn.addEventListener('click', function () { insertSnippet(sn); });
    return btn;
  }

  function insertSnippet(sn) {
    const tas = el.commentBlocks.querySelectorAll('.comment-block-textarea');
    if (!tas.length) return;
    const ta = tas[Math.min(lastBlockIdx, tas.length - 1)];
    const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const end = ta.selectionEnd != null ? ta.selectionEnd : start;
    const before = ta.value.slice(0, start);
    let insert = sn.text;
    // Snippets are block-level comments — separate from existing text with a
    // paragraph break rather than splicing mid-sentence.
    if (before.trim() && !/\n\n$/.test(before)) {
      insert = (/\n$/.test(before) ? '\n' : '\n\n') + insert;
    }
    ta.value = before + insert + ta.value.slice(end);
    hideSnippetPicker();
    ta.focus();
    const caret = before.length + insert.length;
    ta.setSelectionRange(caret, caret);
    // The textarea's own 'input' listener (redpen-author-comments.js) owns the
    // draft-state/preview/save-button updates — trigger it instead of poking
    // state.editingBlocks from here.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  function wireSnippets() {
    el.btnSnippets.addEventListener('click', openSnippetManager);
    el.snippetModalClose.addEventListener('click', closeSnippetManager);
    R.wireBackdropClose(el.snippetModalBackdrop, closeSnippetManager);
    el.btnAddSnippetRow.addEventListener('click', addNewSnippetRow);
    el.snippetMdInput.addEventListener('change', handleSnippetFile);

    el.btnInsertSnippet.addEventListener('click', toggleSnippetPicker);
    el.snippetPickerManage.addEventListener('click', openSnippetManager);
    el.snippetPickerFilter.addEventListener('input', renderSnippetPickerList);
    el.snippetPickerFilter.addEventListener('keydown', function (e) {
      // Enter inserts the top match so filter-and-hit-Enter needs no mouse.
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = el.snippetPickerList.querySelector('.snippet-pick');
        if (first) first.click();
      }
    });

    el.commentBlocks.addEventListener('focusin', function (e) {
      const t = e.target;
      if (!(t.classList && t.classList.contains('comment-block-textarea'))) return;
      const tas = el.commentBlocks.querySelectorAll('.comment-block-textarea');
      const idx = Array.prototype.indexOf.call(tas, t);
      if (idx !== -1) lastBlockIdx = idx;
    });
  }

  R.wireSnippets = wireSnippets;
  R.openSnippetManager = openSnippetManager;
  R.closeSnippetManager = closeSnippetManager;
  R.hideSnippetPicker = hideSnippetPicker;
  // Exposed for the headless tests (tests/test_snippets.py).
  R.parseSnippetsMarkdown = parseSnippetsMarkdown;
})();
