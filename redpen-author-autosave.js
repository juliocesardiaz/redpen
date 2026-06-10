/* redpen — author mode: autosave + draft restore
 *
 * Loads after the tags file and before the main/wiring file. Persists the
 * in-memory queue so unexported grading work survives a refresh or crash.
 *
 * Two independent layers:
 *   1. localStorage (always on): instant, silent, debounced. Source of the
 *      "Restore?" prompt on the next page load.
 *   2. On-disk backup file (opt-in): File System Access API. The grader picks
 *      a path once; subsequent autosaves silently rewrite that file using the
 *      existing exporter. Browsers without the API just hide the button.
 *
 * The single entry point is R.markDirty(), called from every mutation site
 * that previously stamped state.submission.updatedAt directly. See
 * redpen-author-core.js for the shared namespace contract.
 */

(function () {
  'use strict';

  const R = window.Redpen;
  const state = R.state;
  const el = R.el;

  const AUTOSAVE_KEY = 'redpen.autosave.v1';
  const AUTOSAVE_DEBOUNCE_MS = 1500;
  const AUTOSAVE_MAX_WAIT_MS = 10000;

  let autosaveTimer = null;
  let autosaveFirstDirtyAt = 0;
  let autosaveLastSavedAt = 0;
  let autosaveTickTimer = null;
  let backupFileHandle = null;
  let backupFileName = '';
  let autosaveSuspended = false;

  function markDirty() {
    state.submission.updatedAt = Date.now();
    scheduleAutosave();
  }

  function scheduleAutosave() {
    if (autosaveSuspended) return;
    if (!autosaveFirstDirtyAt) autosaveFirstDirtyAt = Date.now();
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const elapsed = Date.now() - autosaveFirstDirtyAt;
    const wait = Math.min(AUTOSAVE_DEBOUNCE_MS, Math.max(0, AUTOSAVE_MAX_WAIT_MS - elapsed));
    autosaveTimer = setTimeout(doAutosave, wait);
  }

  function serializeAutosavePayload() {
    return JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      activeIdx: state.activeIdx,
      queue: state.queue,
    });
  }

  async function doAutosave() {
    autosaveTimer = null;
    autosaveFirstDirtyAt = 0;
    if (autosaveSuspended) return;
    setAutosaveStatus('saving');
    let payload;
    try {
      payload = serializeAutosavePayload();
    } catch (e) {
      console.error('redpen autosave: serialize failed', e);
      setAutosaveStatus('error', 'Save failed');
      return;
    }
    try {
      localStorage.setItem(AUTOSAVE_KEY, payload);
    } catch (e) {
      console.error('redpen autosave: localStorage write failed', e);
      setAutosaveStatus('error', 'Save failed (storage full)');
      return;
    }
    autosaveLastSavedAt = Date.now();
    if (backupFileHandle) {
      try {
        await writeBackupFile();
      } catch (e) {
        console.warn('redpen autosave: backup file write failed', e);
        // Don't escalate to error — localStorage save succeeded. Just clear
        // the handle so the user can re-enable.
        backupFileHandle = null;
        backupFileName = '';
        updateBackupFileButton();
      }
    }
    setAutosaveStatus('saved');
  }

  function setAutosaveStatus(status, message) {
    if (!el.autosaveStatus) return;
    el.autosaveStatus.classList.remove('is-saving', 'is-error');
    let text;
    if (status === 'saving') {
      el.autosaveStatus.classList.add('is-saving');
      text = 'Saving…';
    } else if (status === 'error') {
      el.autosaveStatus.classList.add('is-error');
      text = message || 'Save failed';
    } else if (status === 'idle') {
      text = '';
    } else {
      // 'saved' (default)
      text = autosaveLastSavedAt ? 'Saved ' + relativeTime(autosaveLastSavedAt) : 'Saved';
    }
    if (backupFileName && (status === 'saved' || status === 'idle')) {
      text = (text ? text + ' · ' : '') + 'Backup: ' + backupFileName;
    }
    el.autosaveStatus.textContent = text;
  }

  function relativeTime(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    return h + 'h ago';
  }

  function startAutosaveTicker() {
    if (autosaveTickTimer) return;
    autosaveTickTimer = setInterval(function () {
      // Refresh the relative time on the indicator while idle.
      if (!autosaveTimer && autosaveLastSavedAt) setAutosaveStatus('saved');
    }, 5000);
  }

  // ---- File System Access API backup ----

  function backupApiAvailable() {
    return typeof window.showSaveFilePicker === 'function';
  }

  async function enableBackupFile() {
    if (!backupApiAvailable()) {
      alert('Your browser doesn\'t support choosing a backup file. ' +
            'Use Chrome or Edge for an auto-saved file on disk. ' +
            'Your work is still being saved in this browser.');
      return;
    }
    const suggested = (slugForActive() || 'redpen-grading') + '.html';
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'redpen export', accept: { 'text/html': ['.html'] } }],
      });
    } catch (e) {
      // User cancelled the picker — silently no-op.
      if (e && e.name === 'AbortError') return;
      console.warn('redpen autosave: backup file picker failed', e);
      return;
    }
    backupFileHandle = handle;
    backupFileName = handle.name || suggested;
    updateBackupFileButton();
    // Do an immediate write so the file isn't empty.
    try {
      await writeBackupFile();
      setAutosaveStatus('saved');
    } catch (e) {
      console.warn('redpen autosave: initial backup write failed', e);
      backupFileHandle = null;
      backupFileName = '';
      updateBackupFileButton();
    }
  }

  function slugForActive() {
    const submission = state.submission;
    if (window.slugForSubmission && submission.studentName && submission.assignmentName) {
      return window.slugForSubmission(submission);
    }
    return '';
  }

  async function writeBackupFile() {
    if (!backupFileHandle) return;
    // Build the same HTML as a manual export. If the active submission isn't
    // exportable (missing names or unrendered code), write a minimal JSON
    // fallback so the file isn't stale or empty.
    let content;
    try {
      content = window.buildExportHtml(state.submission);
    } catch (_) {
      content = serializeAutosavePayload();
    }
    const writable = await backupFileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  function updateBackupFileButton() {
    if (!el.btnBackupFile) return;
    if (!backupApiAvailable()) {
      el.btnBackupFile.classList.add('hidden');
      return;
    }
    el.btnBackupFile.classList.remove('hidden');
    el.btnBackupFile.textContent = backupFileHandle
      ? 'Backup: ' + backupFileName
      : 'Enable backup file';
  }

  // ---- Restore prompt ----

  function loadAutosaveDraft() {
    let raw;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (_) { return null; }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.queue) || parsed.queue.length === 0) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function clearAutosaveDraft() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) {}
  }

  function showRestoreBanner(payload) {
    if (!el.restoreBanner) return;
    const ts = payload.savedAt ? new Date(payload.savedAt) : null;
    const when = ts ? relativeTime(ts.getTime()) : 'earlier';
    const count = payload.queue.length;
    el.restoreBannerMsg.textContent =
      'Unsaved grading work from ' + when +
      ' (' + count + (count === 1 ? ' submission' : ' submissions') + ').';
    el.restoreBanner.classList.remove('hidden');
    // Don't autosave (and clobber the draft) until the user decides.
    autosaveSuspended = true;
  }

  function hideRestoreBanner() {
    if (el.restoreBanner) el.restoreBanner.classList.add('hidden');
    autosaveSuspended = false;
  }

  function restoreFromDraft(payload) {
    autosaveSuspended = true;
    try {
      const restoredQueue = payload.queue.map(normalizeRestoredSubmission);
      const idx = Math.max(0, Math.min(restoredQueue.length - 1, payload.activeIdx | 0));
      // Reassign the shared state properties — the other author files all
      // read state.queue / state.submission, so a local rebind would leave
      // them pointing at the stale boot queue and the restore would no-op.
      state.queue = restoredQueue;
      state.activeIdx = idx;
      state.submission = state.queue[state.activeIdx];
      R.loadSubmissionIntoUI();
    } finally {
      autosaveSuspended = false;
    }
    autosaveLastSavedAt = payload.savedAt || Date.now();
    setAutosaveStatus('saved');
  }

  function normalizeRestoredSubmission(s) {
    // Defensive copy so a malformed draft can't break later code paths.
    const base = R.newSubmission();
    if (!s || typeof s !== 'object') return base;
    return Object.assign(base, {
      id: typeof s.id === 'string' ? s.id : base.id,
      studentName: typeof s.studentName === 'string' ? s.studentName : '',
      assignmentName: typeof s.assignmentName === 'string' ? s.assignmentName : '',
      language: typeof s.language === 'string' ? s.language : 'python',
      code: typeof s.code === 'string' ? s.code : '',
      score: s.score && typeof s.score === 'object'
        ? { earned: s.score.earned ?? null, total: s.score.total ?? null }
        : { earned: null, total: null },
      overallComment: typeof s.overallComment === 'string' ? s.overallComment : '',
      annotations: Array.isArray(s.annotations) ? s.annotations : [],
      tags: Array.isArray(s.tags) && s.tags.length ? s.tags : R.defaultTags(),
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : base.createdAt,
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : base.updatedAt,
      _username: typeof s._username === 'string' ? s._username : undefined,
    });
  }

  function wireAutosave() {
    updateBackupFileButton();
    if (el.btnBackupFile) {
      el.btnBackupFile.addEventListener('click', enableBackupFile);
    }
    if (el.restoreBannerRestore) {
      el.restoreBannerRestore.addEventListener('click', function () {
        const payload = loadAutosaveDraft();
        hideRestoreBanner();
        if (payload) restoreFromDraft(payload);
      });
    }
    if (el.restoreBannerDiscard) {
      el.restoreBannerDiscard.addEventListener('click', function () {
        clearAutosaveDraft();
        hideRestoreBanner();
        setAutosaveStatus('idle');
      });
    }
    // Save on tab close as a best-effort cushion against missed debounces.
    window.addEventListener('beforeunload', function () {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
        try { localStorage.setItem(AUTOSAVE_KEY, serializeAutosavePayload()); } catch (_) {}
      }
    });
    startAutosaveTicker();

    // Surface a saved draft from a prior session so work that wasn't exported
    // is recoverable. The banner is non-blocking; the user chooses Restore or
    // Discard.
    const draft = loadAutosaveDraft();
    if (draft) {
      // If the only thing in storage is a fresh, untouched submission, skip
      // the banner — restoring a blank draft just confuses people.
      const meaningful = draft.queue.some(function (s) {
        return !!(s && (s.code || s.studentName || s.assignmentName ||
          s.overallComment || (s.annotations && s.annotations.length)));
      });
      if (meaningful) showRestoreBanner(draft);
    }
  }

  function resetAutosaveTimers() {
    autosaveLastSavedAt = 0;
    setAutosaveStatus('idle');
  }

  R.markDirty = markDirty;
  R.scheduleAutosave = scheduleAutosave;
  R.wireAutosave = wireAutosave;
  R.clearAutosaveDraft = clearAutosaveDraft;
  R.resetAutosaveTimers = resetAutosaveTimers;
})();
