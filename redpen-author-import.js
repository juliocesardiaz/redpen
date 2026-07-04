/* redpen — author mode: queue + folder/CSV/GitHub import
 *
 * Owns the multi-submission queue: importing a folder of files, one or more
 * files straight from GitHub, the optional names CSV, switching between
 * queue items, the queue drawer, navigation arrows, and batch "Export all"
 * via JSZip. See redpen-author-core.js for the shared namespace contract.
 */

(function () {
  'use strict';

  const R = window.Redpen;
  const state = R.state;
  const el = R.el;

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

  // ------------------------------------------------------------------
  // GitHub import — fetch one or more source files straight from GitHub
  // (public repos via raw.githubusercontent.com, private repos via a
  // personal access token against the Contents API) and add each as a
  // queue submission, the same way folder import does.
  // ------------------------------------------------------------------

  function parseGithubUrl(raw) {
    const url = (raw || '').trim();
    if (!url) return null;
    const noHash = url.split('#')[0]; // drop a trailing #L12 / #L12-L34 anchor
    let m = noHash.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/);
    if (m) return { owner: m[1], repo: m[2], ref: m[3], path: m[4] };
    m = noHash.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/);
    if (m) return { owner: m[1], repo: m[2], ref: m[3], path: m[4] };
    // Shorthand: "owner/repo/path/to/file.ext" with no ref — the ref is
    // resolved against the repo's default branch when fetched.
    m = noHash.match(/^(?:https?:\/\/github\.com\/)?([^\/\s]+)\/([^\/\s]+)\/(.+)$/);
    if (m) return { owner: m[1], repo: m[2], ref: null, path: m[3] };
    return null;
  }

  async function resolveDefaultRef(owner, repo, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'token ' + token;
    const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), { headers: headers });
    if (!res.ok) throw new Error('could not resolve default branch (HTTP ' + res.status + ')');
    const json = await res.json();
    return json.default_branch || 'main';
  }

  // loc.path is taken verbatim from the source URL (already percent-encoded
  // where it came from a URL) so it's reused as-is when building the fetch
  // URL rather than re-encoding it.
  async function fetchGithubFileContent(loc, token) {
    const ref = loc.ref || await resolveDefaultRef(loc.owner, loc.repo, token);
    if (token) {
      const apiUrl = 'https://api.github.com/repos/' + encodeURIComponent(loc.owner) + '/' + encodeURIComponent(loc.repo) +
        '/contents/' + loc.path + '?ref=' + encodeURIComponent(ref);
      const res = await fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github.raw+json', Authorization: 'token ' + token },
      });
      if (!res.ok) throw new Error('GitHub API error ' + res.status);
      return await res.text();
    }
    const rawUrl = 'https://raw.githubusercontent.com/' + encodeURIComponent(loc.owner) + '/' + encodeURIComponent(loc.repo) +
      '/' + encodeURIComponent(ref) + '/' + loc.path;
    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' — private repo? add a token');
    return await res.text();
  }

  function githubFilenameParts(path) {
    const decoded = path.split('/').map(decodeURIComponent).join('/');
    const filename = decoded.slice(decoded.lastIndexOf('/') + 1);
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
    return { filename: filename, stem: stem, ext: ext };
  }

  async function makeSubmissionFromGithubUrl(url, token) {
    const loc = parseGithubUrl(url);
    if (!loc) throw new Error('not a recognized GitHub file URL');
    const text = (await fetchGithubFileContent(loc, token)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parsed = githubFilenameParts(loc.path);
    const s = R.newSubmission();
    s._username = loc.owner;
    s.studentName = R.findNameInCsv(loc.owner) || loc.owner;
    s.assignmentName = loc.repo;
    s.language = LANG_BY_EXT[parsed.ext] || state.submission.language;
    s.code = text;
    return s;
  }

  async function importFromGithub(urlsText, token) {
    const lines = (urlsText || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    const built = [];
    const failures = [];
    for (const line of lines) {
      try {
        built.push(await makeSubmissionFromGithubUrl(line, token));
      } catch (e) {
        failures.push({ url: line, error: e.message });
      }
    }
    if (built.length) appendToQueue(built);
    return { built: built, failures: failures };
  }

  function openGithubModal() {
    el.githubModalStatus.textContent = '';
    el.githubModalBackdrop.classList.remove('hidden');
    setTimeout(function () { el.githubUrls.focus(); }, 0);
  }

  function closeGithubModal() {
    el.githubModalBackdrop.classList.add('hidden');
    el.githubToken.value = ''; // never persist a pasted token past this dialog
  }

  async function runGithubImport() {
    const urlsText = el.githubUrls.value;
    if (!urlsText.trim()) {
      el.githubModalStatus.textContent = 'Paste at least one GitHub file URL.';
      return;
    }
    const token = el.githubToken.value.trim();
    el.githubModalImport.disabled = true;
    el.githubModalStatus.textContent = 'Importing…';
    try {
      const result = await importFromGithub(urlsText, token);
      if (result.failures.length) {
        el.githubModalStatus.textContent = 'Imported ' + result.built.length + ' / ' + (result.built.length + result.failures.length) + '. Failed:\n' +
          result.failures.map(function (f) { return f.url + ' — ' + f.error; }).join('\n');
        // Leave successfully-parsed lines out of the box, but keep failures so
        // the teacher can fix and retry without retyping everything.
        el.githubUrls.value = result.failures.map(function (f) { return f.url; }).join('\n');
        el.githubToken.value = '';
      } else {
        closeGithubModal();
        el.githubUrls.value = '';
      }
    } catch (e) {
      el.githubModalStatus.textContent = 'Import failed: ' + e.message;
    } finally {
      el.githubModalImport.disabled = false;
    }
  }

  function isPristineSubmission(s) {
    return !s.studentName && !s.assignmentName && !s.code &&
           s.annotations.length === 0 && !s.overallComment;
  }

  async function makeSubmissionFromFile(file) {
    const parsed = parseFilename(file.name);
    const text = (await file.text()).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const s = R.newSubmission();
    s._username = parsed.username;
    s.studentName = R.findNameInCsv(parsed.username) || parsed.username;
    s.assignmentName = parsed.project || '';
    s.language = parsed.language || state.submission.language;
    s.code = text;
    return s;
  }

  async function importFolder(fileList) {
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
        built.push(await makeSubmissionFromFile(f));
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
    if (state.queue.length === 1 && isPristineSubmission(state.queue[0])) {
      state.queue = submissions.slice();
      state.activeIdx = 0;
      state.submission = state.queue[0];
      loadSubmissionIntoUI();
      checkDuplicates();
      R.scheduleAutosave();
      return;
    }
    state.queue.push.apply(state.queue, submissions);
    checkDuplicates();
    renderQueueDrawer();
    updateQueueCounter();
    updateExportAllButton();
    R.scheduleAutosave();
  }

  function checkDuplicates() {
    const seen = new Map();
    for (const s of state.queue) {
      const key = (s._username || s.studentName) + '|' + s.assignmentName;
      if (seen.has(key)) {
        console.warn('redpen: duplicate submission key', key);
      } else {
        seen.set(key, true);
      }
    }
  }

  function setActive(idx) {
    if (idx < 0 || idx >= state.queue.length) return;
    if (idx === state.activeIdx) return;
    R.closeCommentModal();
    R.closeTooltip();
    R.hideCommentButton();
    state.activeIdx = idx;
    state.submission = state.queue[idx];
    loadSubmissionIntoUI();
    R.scheduleAutosave();
  }

  function loadSubmissionIntoUI() {
    const submission = state.submission;
    el.studentName.value = submission.studentName || '';
    el.assignmentName.value = submission.assignmentName || '';
    el.languageSelect.value = submission.language || 'python';
    el.scoreEarned.value = submission.score && submission.score.earned !== null && submission.score.earned !== undefined ? String(submission.score.earned) : '';
    el.scoreTotal.value = submission.score && submission.score.total !== null && submission.score.total !== undefined ? String(submission.score.total) : '';
    el.overallComment.value = submission.overallComment || '';
    R.setOverallView('edit');
    if (submission.code && submission.code.length > 0) {
      el.codeInput.value = submission.code;
      R.renderCodeView();
      R.showRenderedView();
    } else {
      el.codeInput.value = '';
      R.showEmptyView();
    }
    R.renderAnnotationList();
    renderQueueDrawer();
    updateQueueCounter();
    updateExportAllButton();
  }

  function renderQueueDrawer() {
    if (!el.queueList) return;
    el.queueCount.textContent = String(state.queue.length);
    el.queueList.innerHTML = '';
    state.queue.forEach(function (s, i) {
      const li = document.createElement('li');
      li.className = 'queue-item' + (i === state.activeIdx ? ' active' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('data-idx', String(i));
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-selected', i === state.activeIdx ? 'true' : 'false');
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
    if (state.queue.length <= 1) {
      el.queueCounter.textContent = '';
      el.btnPrev.disabled = true;
      el.btnNext.disabled = true;
      return;
    }
    el.queueCounter.textContent = 'Student ' + (state.activeIdx + 1) + '/' + state.queue.length + ': ' + displayLabel(state.submission);
    el.btnPrev.disabled = state.activeIdx <= 0;
    el.btnNext.disabled = state.activeIdx >= state.queue.length - 1;
  }

  function updateExportAllButton() {
    if (!el.btnExportAll) return;
    const enabled = state.queue.length > 1 && !!window.JSZip;
    el.btnExportAll.disabled = !enabled;
    if (!window.JSZip) {
      el.btnExportAll.title = 'JSZip failed to load';
    } else if (state.queue.length <= 1) {
      el.btnExportAll.title = 'Import a folder to enable batch export';
    } else {
      el.btnExportAll.title = 'Export all submissions as a zip';
    }
  }

  function prevSubmission() { setActive(state.activeIdx - 1); }
  function nextSubmission() { setActive(state.activeIdx + 1); }

  function wireImport() {
    el.folderInput.addEventListener('change', async function (e) {
      const files = e.target.files;
      await importFolder(files);
      e.target.value = '';
    });
    el.csvInput.addEventListener('change', async function (e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        state.csvRows = parseCsv(text);

        // Re-derive student names for any entries that were imported before
        // the CSV. Only overwrite entries whose studentName still matches the
        // raw username (i.e., the teacher hasn't manually edited them).
        let touched = 0;
        for (const s of state.queue) {
          const realName = R.findNameInCsv(s._username);
          if (realName) {
            const current = (s.studentName || '').trim().toLowerCase();
            const username = (s._username || '').trim().toLowerCase();
            if (current === username || current === '') {
              s.studentName = realName;
              touched++;
            }
          }
        }

        // Visible feedback
        const label = document.getElementById('csv-input-label');
        if (label) {
          const originalText = label.textContent;
          label.textContent = `Names CSV ✓ ${state.csvRows.length} rows`;
          setTimeout(() => { label.textContent = originalText; }, 2500);
        }
        console.info('redpen: loaded', state.csvRows.length, 'CSV rows');

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

    el.btnImportGithub.addEventListener('click', openGithubModal);
    el.githubModalCancel.addEventListener('click', closeGithubModal);
    el.githubModalImport.addEventListener('click', runGithubImport);
    el.githubModalBackdrop.addEventListener('click', function (e) {
      if (e.target === el.githubModalBackdrop) closeGithubModal();
    });
  }

  function wireQueueDrawer() {
    el.queueDrawerHandle.addEventListener('click', function () {
      const collapsed = el.queueDrawer.classList.toggle('collapsed');
      el.queueDrawerHandle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      document.body.classList.toggle('queue-open', !collapsed);
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
    if (state.queue.length <= 1) return;
    const entries = [];
    const failures = [];
    // Detached <code> element used as the off-screen render target. Reused
    // across the loop — innerHTML is overwritten each iteration. The visible
    // UI is no longer cycled through every submission.
    const offscreen = document.createElement('code');
    for (let i = 0; i < state.queue.length; i++) {
      const s = state.queue[i];
      try {
        R.renderCodeView(offscreen, s);
        const html = window.buildExportHtml(s, offscreen.innerHTML);
        const filename = window.slugForSubmission(s) + '.html';
        entries.push({ filename: filename, html: html });
      } catch (err) {
        failures.push({ idx: i, name: displayLabel(s), error: err.message });
      }
    }
    if (entries.length === 0) {
      alert('No submissions exported. Issues:\n' + failures.map(function (f) { return '- ' + f.name + ': ' + f.error; }).join('\n'));
      return;
    }
    await window.exportZipFromBuiltEntries(entries, deriveBatchFilename());
    if (failures.length > 0) {
      alert('Exported ' + entries.length + ' / ' + state.queue.length + '. Skipped:\n' +
        failures.map(function (f) { return '- ' + f.name + ': ' + f.error; }).join('\n'));
    }
  }

  function deriveBatchFilename() {
    const counts = new Map();
    let max = 0;
    let winner = '';
    for (const s of state.queue) {
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

  R.renderQueueDrawer = renderQueueDrawer;
  R.updateQueueCounter = updateQueueCounter;
  R.updateExportAllButton = updateExportAllButton;
  R.loadSubmissionIntoUI = loadSubmissionIntoUI;
  R.wireImport = wireImport;
  R.wireQueueDrawer = wireQueueDrawer;
  R.closeGithubModal = closeGithubModal;
})();
