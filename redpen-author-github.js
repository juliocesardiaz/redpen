/* redpen — author mode: GitHub / CS50 import modal
 *
 * Owns the #github-modal-backdrop dialog and its three modes:
 * (1) GitHub file URLs — public repos via raw.githubusercontent.com, private
 *     via an optional token against the Contents API;
 * (2) CS50 manual — submit50 pushes each student's work to a PRIVATE repo
 *     github.com/<org>/<username> (org defaults to "me50"), branch = problem
 *     slug, so owner/repo semantics invert vs. mode 1 and a token is
 *     mandatory; the branch tree is listed and the likeliest file is
 *     auto-picked (stem matching the slug's last segment wins, then
 *     shallowest path, then alphabetical);
 * (3) CS50 JSON — the per-assignment export downloaded from submit.cs50.io,
 *     whose github_url pins the exact submitted commit SHA; real names and
 *     check50 checks_passed/checks_run prefill studentName and the score.
 *
 * Network access here is opt-in and teacher-initiated (same precedent as the
 * CDN hljs fallback); exported files stay fully offline. Built submissions
 * enter the queue through R.appendToQueue / R.buildQueueSubmission — the
 * queue itself lives in redpen-author-import.js. See redpen-author-core.js
 * for the shared namespace contract.
 */

(function () {
  'use strict';

  const R = window.Redpen;
  const el = R.el;

  // GitHub REST headers: the requested media type plus, when present, the
  // token in the Authorization format all three modes share.
  function apiHeaders(accept, token) {
    const headers = { Accept: accept };
    if (token) headers.Authorization = 'token ' + token;
    return headers;
  }

  // ------------------------------------------------------------------
  // GitHub URL mode — fetch files by their github.com/raw URLs
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
    const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), {
      headers: apiHeaders('application/vnd.github+json', token),
    });
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
        headers: apiHeaders('application/vnd.github.raw+json', token),
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

  async function makeSubmissionFromGithubUrl(url, token) {
    const loc = parseGithubUrl(url);
    if (!loc) throw new Error('not a recognized GitHub file URL');
    return R.buildQueueSubmission({
      username: loc.owner,
      filename: decodeURIComponent(loc.path.split('/').pop()),
      code: await fetchGithubFileContent(loc, token),
      assignmentName: loc.repo,
    });
  }

  // ------------------------------------------------------------------
  // CS50 (submit50) modes — list the submission's branch/commit tree,
  // auto-pick the likeliest source file, fetch it via the API.
  // ------------------------------------------------------------------

  async function fetchBranchTree(org, repo, ref, token) {
    // Slug refs contain slashes ("cs50/problems/2024/x/hello") — encode per
    // segment so they survive as path components.
    const encodedRef = String(ref).split('/').map(encodeURIComponent).join('/');
    const url = 'https://api.github.com/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) +
      '/git/trees/' + encodedRef + '?recursive=1';
    const res = await fetch(url, {
      headers: apiHeaders('application/vnd.github+json', token),
    });
    if (res.status === 404) {
      // GitHub answers 404 (not 403) when the token can't see a private
      // repo, so "no access" and "no submission" are indistinguishable here.
      throw new Error('HTTP 404 — no access or no submission. Use a classic token with the repo scope, ' +
        'confirm you can open github.com/' + org + '/' + repo + ' in the browser while signed in, ' +
        'and check the username and slug.');
    }
    if (!res.ok) throw new Error('GitHub API error ' + res.status);
    const json = await res.json();
    return (json.tree || [])
      .filter(function (node) { return node.type === 'blob'; })
      .map(function (node) { return node.path; });
  }

  function basename(p) {
    return p.slice(p.lastIndexOf('/') + 1);
  }

  function cs50CandidateFiles(paths) {
    return paths.filter(function (p) {
      const f = basename(p);
      return f !== '.cs50.yml' && R.isTextFilename(f);
    });
  }

  function slugLastSegment(slug) {
    const parts = (slug || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function primaryFileGuess(paths, slug) {
    if (paths.length === 1) return paths[0];
    const target = slugLastSegment(slug).toLowerCase();
    const matches = paths.filter(function (p) {
      return R.splitExt(basename(p)).stem.toLowerCase() === target;
    });
    // Shallowest path first, then alphabetical, for a deterministic pick.
    const pool = (matches.length ? matches : paths).slice();
    pool.sort(function (a, b) {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return pool[0];
  }

  async function buildCs50Submission(org, username, ref, slug, token) {
    const paths = await fetchBranchTree(org, username, ref, token);
    const candidates = cs50CandidateFiles(paths);
    if (!candidates.length) throw new Error('no source files found in the submission');
    const picked = primaryFileGuess(candidates, slug);
    // fetchGithubFileContent expects an already-encoded path (URL-mode paths
    // arrive percent-encoded); tree paths are raw, so encode per segment.
    const encodedPath = picked.split('/').map(encodeURIComponent).join('/');
    const submission = R.buildQueueSubmission({
      username: username,
      filename: basename(picked),
      code: await fetchGithubFileContent({ owner: org, repo: username, ref: ref, path: encodedPath }, token),
      assignmentName: slugLastSegment(slug),
    });
    return { submission: submission, pickedFile: picked };
  }

  function parseCs50Export(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('not valid JSON');
    }
    // submit.cs50.io exports {"<slug>": [entries]}; tolerate a bare array too.
    let rawEntries = [];
    if (Array.isArray(data)) {
      rawEntries = data;
    } else if (data && typeof data === 'object') {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) rawEntries = rawEntries.concat(data[key]);
      }
    }
    if (!rawEntries.length) {
      throw new Error('no submissions found — expected the {"<slug>": [...]} file downloaded from submit.cs50.io');
    }
    const entries = [];
    for (const e of rawEntries) {
      if (!e || typeof e !== 'object') continue;
      const url = e.github_url || e.archive || '';
      const m = String(url).match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(?:tree|archive)\/([0-9a-f]{7,40})/i);
      const username = e.github_username || (m ? m[2] : '');
      if (!m || !username) continue;
      entries.push({
        owner: m[1],
        repo: m[2],
        sha: m[3],
        username: username,
        name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : null,
        slug: e.slug || '',
        checksPassed: Number.isFinite(e.checks_passed) ? e.checks_passed : null,
        checksRun: Number.isFinite(e.checks_run) ? e.checks_run : null,
      });
    }
    if (!entries.length) throw new Error('no usable entries — rows are missing github_url/archive links');
    return entries;
  }

  async function makeSubmissionFromCs50Entry(entry, token) {
    const r = await buildCs50Submission(entry.owner, entry.repo, entry.sha, entry.slug, token);
    const s = r.submission;
    s._username = entry.username;
    s.studentName = entry.name || R.findNameInCsv(entry.username) || entry.username;
    if (entry.checksPassed !== null && entry.checksRun !== null) {
      s.score.earned = entry.checksPassed;
      s.score.total = entry.checksRun;
    }
    return { submission: s, pickedFile: r.pickedFile };
  }

  function cs50ResultSummary(result) {
    const total = result.picks.length + result.failures.length;
    const lines = ['Imported ' + result.picks.length + ' / ' + total + '.'];
    if (result.picks.length) {
      lines.push('Files used: ' + result.picks.map(function (p) { return p.username + ' → ' + p.pickedFile; }).join(', '));
    }
    if (result.failures.length) {
      lines.push('Failed:');
      for (const f of result.failures) lines.push(f.label + ' — ' + f.error);
    }
    return lines.join('\n');
  }

  // ------------------------------------------------------------------
  // Modal state, mode toggle, and the three run functions
  // ------------------------------------------------------------------

  // Mode and parsed-JSON stash survive close/reopen on purpose: a teacher
  // importing a whole assignment in batches shouldn't have to re-toggle or
  // re-pick the file every time.
  let importMode = 'url';
  let cs50JsonEntries = null;

  const TOKEN_REQUIRED = 'A personal access token is required — submit50 repos are private.';

  // Fine-grained tokens (github_pat_…) can only access resources owned by
  // their chosen resource owner — normally the teacher's own account — so
  // they can never read repos in the me50 org, and GitHub answers 404 (not
  // 403) for private repos a token can't see. Fail fast with the reason
  // instead of producing N confusing per-student 404s.
  function cs50TokenProblem(token) {
    if (!token) return TOKEN_REQUIRED;
    if (token.startsWith('github_pat_')) {
      return 'Fine-grained tokens (github_pat_…) can’t read me50 org repos — create a classic token (ghp_…) with the repo scope instead.';
    }
    return null;
  }

  function setGithubImportMode(mode) {
    importMode = mode;
    R.selectToggle('data-import-mode', mode, el.githubModalBackdrop);
    el.githubUrlFields.classList.toggle('hidden', mode !== 'url');
    el.cs50Fields.classList.toggle('hidden', mode !== 'cs50');
    el.cs50JsonFields.classList.toggle('hidden', mode !== 'cs50json');
    el.githubModalStatus.textContent = '';
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

  function splitLines(text) {
    return (text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  }

  // Shared batch loop for the three modes. buildOne(item) resolves to
  // { submission, pick? } or throws; pick is { username, pickedFile } where
  // the CS50 modes auto-picked a file. labelOf(item) names the item in
  // failure/retry text (the URL in URL mode, the username in CS50 modes).
  async function importBatch(items, buildOne, labelOf) {
    const built = [];
    const picks = [];
    const failures = [];
    for (const item of items) {
      try {
        const r = await buildOne(item);
        built.push(r.submission);
        if (r.pick) picks.push(r.pick);
      } catch (e) {
        failures.push({ label: labelOf(item), error: e.message });
      }
    }
    if (built.length) R.appendToQueue(built);
    return { built: built, picks: picks, failures: failures };
  }

  // Shared scaffolding for the three run functions. validate() returns an
  // error string to display or null to proceed; onDone(result) handles the
  // mode-specific success/partial-failure UI.
  async function runModalImport(validate, doImport, onDone) {
    const err = validate();
    if (err) {
      el.githubModalStatus.textContent = err;
      return;
    }
    el.githubModalImport.disabled = true;
    el.githubModalStatus.textContent = 'Importing…';
    try {
      onDone(await doImport());
    } catch (e) {
      el.githubModalStatus.textContent = 'Import failed: ' + e.message;
    } finally {
      el.githubModalImport.disabled = false;
    }
  }

  function runImport() {
    if (importMode === 'cs50') return runCs50Import();
    if (importMode === 'cs50json') return runCs50JsonImport();
    return runGithubUrlImport();
  }

  function runGithubUrlImport() {
    const urls = splitLines(el.githubUrls.value);
    const token = el.githubToken.value.trim();
    return runModalImport(
      function () { return urls.length ? null : 'Paste at least one GitHub file URL.'; },
      function () {
        return importBatch(urls, async function (url) {
          return { submission: await makeSubmissionFromGithubUrl(url, token) };
        }, function (url) { return url; });
      },
      function (result) {
        if (result.failures.length) {
          el.githubModalStatus.textContent = 'Imported ' + result.built.length + ' / ' + (result.built.length + result.failures.length) + '. Failed:\n' +
            result.failures.map(function (f) { return f.label + ' — ' + f.error; }).join('\n');
          // Leave successfully-parsed lines out of the box, but keep failures so
          // the teacher can fix and retry without retyping everything.
          el.githubUrls.value = result.failures.map(function (f) { return f.label; }).join('\n');
          el.githubToken.value = '';
        } else {
          closeGithubModal();
          el.githubUrls.value = '';
        }
      }
    );
  }

  // Unlike URL mode, the CS50 modes stay open after a successful import so
  // the teacher can review which file was auto-picked for each student.
  function runCs50Import() {
    const org = el.cs50Org.value.trim() || 'me50';
    const slug = el.cs50Slug.value.trim();
    const usernames = splitLines(el.cs50Usernames.value);
    const token = el.githubToken.value.trim();
    return runModalImport(
      function () {
        if (!slug) return 'Enter the problem slug (the branch submit50 pushes to).';
        if (!usernames.length) return 'Paste at least one student GitHub username.';
        return cs50TokenProblem(token);
      },
      function () {
        return importBatch(usernames, async function (username) {
          const r = await buildCs50Submission(org, username, slug, slug, token);
          return { submission: r.submission, pick: { username: username, pickedFile: r.pickedFile } };
        }, function (username) { return username; });
      },
      function (result) {
        // Same retry pattern as URL mode: only failing usernames stay in the box.
        el.cs50Usernames.value = result.failures.map(function (f) { return f.label; }).join('\n');
        el.githubModalStatus.textContent = cs50ResultSummary(result);
      }
    );
  }

  function runCs50JsonImport() {
    const token = el.githubToken.value.trim();
    return runModalImport(
      function () {
        if (!cs50JsonEntries || !cs50JsonEntries.length) return 'Choose a submissions JSON file first.';
        return cs50TokenProblem(token);
      },
      function () {
        return importBatch(cs50JsonEntries, async function (entry) {
          const r = await makeSubmissionFromCs50Entry(entry, token);
          return { submission: r.submission, pick: { username: entry.username, pickedFile: r.pickedFile } };
        }, function (entry) { return entry.username; });
      },
      function (result) {
        el.githubModalStatus.textContent = cs50ResultSummary(result);
      }
    );
  }

  function wireGithubImport() {
    el.btnImportGithub.addEventListener('click', openGithubModal);
    el.githubModalCancel.addEventListener('click', closeGithubModal);
    el.githubModalImport.addEventListener('click', runImport);
    R.wireBackdropClose(el.githubModalBackdrop, closeGithubModal);
    el.githubModalBackdrop.querySelectorAll('[data-import-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { setGithubImportMode(btn.dataset.importMode); });
    });
    el.cs50JsonInput.addEventListener('change', async function (e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        cs50JsonEntries = parseCs50Export(await f.text());
        const slugs = Array.from(new Set(cs50JsonEntries.map(function (en) { return slugLastSegment(en.slug); }).filter(Boolean)));
        const hasScores = cs50JsonEntries.some(function (en) { return en.checksPassed !== null; });
        el.cs50JsonSummary.textContent = (slugs.join(', ') || f.name) + ' — ' +
          cs50JsonEntries.length + ' student' + (cs50JsonEntries.length === 1 ? '' : 's') +
          (hasScores ? ' (check50 scores will prefill)' : '');
      } catch (err) {
        cs50JsonEntries = null;
        el.cs50JsonSummary.textContent = 'Could not read ' + f.name + ': ' + err.message;
      }
      e.target.value = '';
    });
  }

  R.wireGithubImport = wireGithubImport;
  R.closeGithubModal = closeGithubModal;
})();
