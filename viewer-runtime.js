// Shared runtime for redpen viewer

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Same escaping suffices for attribute values; the separate name keeps
  // call sites self-documenting.
  const escapeAttr = escapeHtml;

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/"/g, '\\"');
  }

  function findById(list, id) {
    for (let i = 0; i < (list ? list.length : 0); i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  // Aliases map user-written fence languages onto hljs grammar names. Any
  // language not listed (and any unknown name) falls back to plain monospace.
  // 'html' aliases to 'xml' — hljs ships HTML as its xml grammar, so a ```html
  // fence would otherwise silently render unhighlighted.
  const MD_LANG_ALIAS = {
    python: 'python', py: 'python',
    javascript: 'javascript', js: 'javascript',
    html: 'xml', xml: 'xml',
    css: 'css',
    diff: 'diff', patch: 'diff',
  };

  function renderMarkdown(source) {
    if (!source) return '';
    if (typeof source !== 'string') {
      if (source && typeof source.text === 'string') source = source.text;
      else return '';
    }
    const lines = source.split('\n');
    let out = '';
    let inList = false;
    let inCode = false;
    let codeBlock = '';
    let codeLang = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (inCode) {
          out += '<div class="md-code-wrap">';
          if (codeLang) out += '<span class="md-code-lang">' + escapeHtml(codeLang) + '</span>';
          out += '<button class="md-code-copy" type="button" aria-label="Copy code">Copy</button>';
          out += '<pre class="md-code-pre"><code class="hljs ' + escapeAttr(codeLang) + '">';
          const hljsLang = MD_LANG_ALIAS[codeLang];
          const hasGrammar = hljsLang && window.hljs &&
            (window.hljs.getLanguage ? !!window.hljs.getLanguage(hljsLang) : true);
          if (hasGrammar) {
            try {
              out += window.hljs.highlight(codeBlock, { language: hljsLang, ignoreIllegals: true }).value;
            } catch (e) {
              out += escapeHtml(codeBlock);
            }
          } else {
            out += escapeHtml(codeBlock);
          }
          out += '</code></pre></div>';
          inCode = false;
        } else {
          inCode = true;
          codeLang = line.substring(3).trim();
          codeBlock = '';
        }
        continue;
      }

      if (inCode) {
        codeBlock += line + '\n';
        continue;
      }

      const isListItem = line.trim().startsWith('- ');
      if (isListItem && !inList) { out += '<ul>\n'; inList = true; }
      if (!isListItem && inList) { out += '</ul>\n'; inList = false; }

      if (isListItem) {
        let content = line.trim().substring(2);
        out += '<li>' + renderInlineMarkdown(content) + '</li>\n';
      } else if (line.trim() === '') {
        // empty line
      } else {
        out += '<p>' + renderInlineMarkdown(line) + '</p>\n';
      }
    }

    if (inList) out += '</ul>\n';
    return out;
  }

  function renderInlineMarkdown(text) {
    let out = escapeHtml(text);
    // **bold**
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // *italic*
    out = out.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
    // `code`
    out = out.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    // [text](url) — function-form replace so a URL containing $&, $1, or $$
    // can't be interpreted by the replacement-string mini-language.
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    return out;
  }

  // ------------------------------------------------------------------
  // Shared tooltip helpers (used by both author mode and the viewer)
  // ------------------------------------------------------------------

  /**
   * Fill a tooltip's content element for an annotation: optional tag row,
   * then each comment rendered as markdown with dividers between. The two
   * modes style tag pills differently (author: .tag-pill + --tag-color;
   * viewer: .tag-chip with inline colors), so the pill factory is injected.
   */
  function renderTooltipContent(contentEl, annotation, getTagById, makeTagPill) {
    contentEl.innerHTML = '';
    if (annotation.tagIds && annotation.tagIds.length > 0) {
      const row = document.createElement('div');
      row.className = 'tooltip-tags';
      for (const id of annotation.tagIds) {
        const t = getTagById(id);
        if (t) row.appendChild(makeTagPill(t));
      }
      if (row.children.length > 0) contentEl.appendChild(row);
    }
    const comments = annotation.comments || [];
    for (let i = 0; i < comments.length; i++) {
      if (i > 0) {
        const hr = document.createElement('hr');
        hr.className = 'tooltip-divider';
        contentEl.appendChild(hr);
      }
      const body = document.createElement('div');
      body.className = 'tooltip-comment markdown-body';
      const c = comments[i];
      body.innerHTML = renderMarkdown(typeof c === 'string' ? c : (c && c.text) || '');
      contentEl.appendChild(body);
    }
  }

  /**
   * Delegated handler for the Copy buttons renderMarkdown emits on fenced
   * code blocks (tooltips, previews, the exported viewer). Reads the raw
   * text from the <code> element so highlight markup doesn't pollute the
   * clipboard; falls back to execCommand for browsers without the async
   * clipboard API.
   */
  function wireCopyButtons() {
    document.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('.md-code-copy');
      if (!btn) return;
      e.stopPropagation();
      const wrap = btn.closest('.md-code-wrap');
      const codeEl = wrap && wrap.querySelector('pre code');
      if (!codeEl) return;
      const text = codeEl.innerText;
      function flash(msg) {
        const prev = btn.textContent;
        btn.textContent = msg;
        setTimeout(function () { btn.textContent = prev; }, 1200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { flash('Copied'); },
          function () { flash('Failed'); }
        );
      } else {
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

  /**
   * Position the tooltip element relative to its anchor. Author and viewer
   * shared this responsibility but had drifted: the author version handled
   * mobile centering, max-height capping when neither below/above fits, and
   * arrow clamping; the viewer's simpler version meant students sometimes saw
   * truncated tooltips. One copy, used by both.
   */
  function positionTooltip(tt, anchorEl) {
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
    if (arrow) {
      const anchorMid = rect.left + rect.width / 2;
      const rawX = anchorMid - left;
      const arrowX = Math.max(18, Math.min(ttW - 18, rawX));
      arrow.style.left = arrowX + 'px';
    }
  }

  /**
   * Resolve a click/hover anywhere inside the code view to its annotation.
   * Innermost wins: climb from the target looking for [data-annotation-id].
   * If none found (e.g., the user clicked the line-range/block wash to the
   * right of all text, or on trailing whitespace) fall back to the .line
   * row's data-line-level-annotation-id, which the author-mode renderer
   * baked in for exactly this case.
   */
  function resolveAnnotationFromTarget(target, codeRoot) {
    let node = target;
    while (node && node !== codeRoot) {
      if (node.dataset && node.dataset.annotationId) {
        return { id: node.dataset.annotationId, anchor: node };
      }
      node = node.parentElement;
    }
    let lineEl = target;
    while (lineEl && lineEl !== codeRoot && !(lineEl.classList && lineEl.classList.contains('line'))) {
      lineEl = lineEl.parentElement;
    }
    if (lineEl && lineEl.dataset && lineEl.dataset.lineLevelAnnotationId) {
      return {
        id: lineEl.dataset.lineLevelAnnotationId,
        anchor: lineEl.querySelector('.line-content') || lineEl,
      };
    }
    return null;
  }

  /**
   * Cross-element hover sync, used by both author mode and the viewer.
   * A single annotation often becomes several sibling .annotation spans
   * (hljs token boundaries split them, multi-line ranges produce one segment
   * per line). Driving the highlight from per-element :hover would only
   * light up the segment under the cursor; drive it from a JS-managed
   * .hovered class so every segment (and, for a line-level annotation,
   * every row in the range) responds as a single unit.
   */
  function wireHoverSync(codeRoot, getAnnotationById) {
    let hoveredId = null;
    function applyHovered(id) {
      const parts = codeRoot.querySelectorAll('[data-annotation-id="' + cssEscape(id) + '"]');
      parts.forEach(function (p) { p.classList.add('hovered'); });
      const a = getAnnotationById(id);
      if (a && (a.type === 'line-range' || a.type === 'block')) {
        for (let ln = a.range.startLine; ln <= a.range.endLine; ln++) {
          const row = codeRoot.querySelector('.line[data-line="' + ln + '"]');
          if (row) row.classList.add('hovered');
        }
      }
    }
    function clearHovered() {
      const parts = codeRoot.querySelectorAll('.annotation.hovered, .line.hovered');
      parts.forEach(function (p) { p.classList.remove('hovered'); });
    }
    function setHovered(id) {
      if (id === hoveredId) return;
      clearHovered();
      hoveredId = id;
      if (id) applyHovered(id);
    }
    codeRoot.addEventListener('mousemove', function (e) {
      const hit = resolveAnnotationFromTarget(e.target, codeRoot);
      setHovered(hit ? hit.id : null);
    });
    codeRoot.addEventListener('mouseleave', function () { setHovered(null); });
  }

  // Expose to window for author mode to use as well
  window.RedpenShared = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    cssEscape: cssEscape,
    findById: findById,
    renderMarkdown: renderMarkdown,
    renderTooltipContent: renderTooltipContent,
    positionTooltip: positionTooltip,
    resolveAnnotationFromTarget: resolveAnnotationFromTarget,
    wireHoverSync: wireHoverSync,
    wireCopyButtons: wireCopyButtons,
  };

  // ------------------------------------------------------------------
  // Viewer Init Logic
  // ------------------------------------------------------------------

  if (!document.getElementById('submission-data')) return; // Exit if not in viewer mode

  let submission = null;
  const tooltip = document.getElementById('tooltip');
  const tooltipContent = document.getElementById('tooltip-content');

  function initViewer() {
    const dataEl = document.getElementById('submission-data');
    if (dataEl) {
      try {
        submission = JSON.parse(dataEl.textContent);
      } catch (e) {
        console.error("Failed to parse submission data", e);
        return;
      }
    }

    wireTooltip();
    wireCopyButtons();
    wireAnnotations();
    wireHint();
    wireAnnotationNav();
  }

  // ---- Discoverability hint -------------------------------------------
  // Shown only when the submission actually has annotations; hidden for
  // good once dismissed or once the student opens any highlight. localStorage
  // may be unavailable from file:// in some browsers — degrade to
  // show-per-load rather than failing.

  const HINT_KEY = 'redpen.viewer.hintDismissed';

  function hintDismissed() {
    try { return localStorage.getItem(HINT_KEY) === '1'; } catch (_) { return false; }
  }

  function dismissHint() {
    const chip = document.getElementById('viewer-hint');
    if (chip) chip.classList.add('hidden');
    try { localStorage.setItem(HINT_KEY, '1'); } catch (_) {}
  }

  function wireHint() {
    const chip = document.getElementById('viewer-hint');
    if (!chip) return;
    const hasAnnotations = submission && submission.annotations && submission.annotations.length > 0;
    if (!hasAnnotations || hintDismissed()) return;
    chip.classList.remove('hidden');
    document.getElementById('viewer-hint-dismiss').addEventListener('click', dismissHint);
  }

  // ---- Prev/next annotation navigation --------------------------------
  // Walks annotations in document order (same sort as the author sidebar),
  // wrapping at the ends. Clicking a highlight directly re-syncs the index.

  let orderedAnnotations = [];
  let navIdx = -1;

  function wireAnnotationNav() {
    const nav = document.getElementById('anno-nav');
    if (!nav || !submission) return;
    orderedAnnotations = (submission.annotations || []).slice().sort(function (a, b) {
      if (a.range.startLine !== b.range.startLine) return a.range.startLine - b.range.startLine;
      return (a.range.startCol || 0) - (b.range.startCol || 0);
    });
    if (orderedAnnotations.length < 2) return; // arrows are pointless for 0-1
    nav.classList.remove('hidden');
    updateNavCounter();
    document.getElementById('anno-nav-prev').addEventListener('click', function () { stepAnnotation(-1); });
    document.getElementById('anno-nav-next').addEventListener('click', function () { stepAnnotation(1); });
  }

  function stepAnnotation(delta) {
    const n = orderedAnnotations.length;
    navIdx = navIdx === -1 ? (delta > 0 ? 0 : n - 1) : (navIdx + delta + n) % n;
    const a = orderedAnnotations[navIdx];
    const seg = document.querySelector('.annotation[data-annotation-id="' + cssEscape(a.id) + '"]');
    if (!seg) return;
    seg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tooltip.dataset.annotationId = a.id;
    populateTooltip(a.id);
    showTooltipAt(seg);
    dismissHint();
    updateNavCounter();
  }

  function syncNavIndex(id) {
    for (let i = 0; i < orderedAnnotations.length; i++) {
      if (orderedAnnotations[i].id === id) { navIdx = i; break; }
    }
    updateNavCounter();
  }

  function updateNavCounter() {
    const counter = document.getElementById('anno-nav-counter');
    if (counter) {
      counter.textContent = (navIdx === -1 ? '–' : navIdx + 1) + '/' + orderedAnnotations.length;
    }
  }

  function getAnnotationById(id) {
    return submission ? findById(submission.annotations, id) : null;
  }

  function getTagById(id) {
    return submission ? findById(submission.tags, id) : null;
  }

  function closeTooltip() {
    tooltip.classList.add('hidden');
    tooltip.dataset.annotationId = '';
  }

  function makeTagPill(t) {
    const pill = document.createElement('span');
    pill.className = 'tag-chip';
    pill.style.backgroundColor = t.color;
    pill.style.color = '#fff';
    pill.textContent = t.label;
    return pill;
  }

  function populateTooltip(annotationId) {
    const a = getAnnotationById(annotationId);
    if (!a) return;
    renderTooltipContent(tooltipContent, a, getTagById, makeTagPill);
  }

  function showTooltipAt(anchor) {
    tooltip.classList.remove('hidden');
    positionTooltip(tooltip, anchor);
  }

  function wireAnnotations() {
    const codeView = document.querySelector('.code-view');
    if (!codeView) return;

    codeView.addEventListener('click', function(e) {
      const hit = resolveAnnotationFromTarget(e.target, codeView);
      if (!hit) return;
      e.stopPropagation();
      if (tooltip.dataset.annotationId === hit.id && !tooltip.classList.contains('hidden')) {
        closeTooltip();
      } else {
        tooltip.dataset.annotationId = hit.id;
        populateTooltip(hit.id);
        showTooltipAt(hit.anchor);
        dismissHint();
        syncNavIndex(hit.id);
      }
    });

    wireHoverSync(codeView, getAnnotationById);
  }

  function wireTooltip() {
    document.addEventListener('click', function (e) {
      if (tooltip.classList.contains('hidden')) return;
      if (tooltip.contains(e.target)) return;
      // The nav arrows open tooltips themselves — the click-away close
      // would otherwise fire right after and shut what they just opened.
      const nav = document.getElementById('anno-nav');
      if (nav && nav.contains(e.target)) return;

      const hit = e.target.closest('.annotation');
      if (hit && hit.dataset.annotationId === tooltip.dataset.annotationId) return;

      closeTooltip();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !tooltip.classList.contains('hidden')) {
        closeTooltip();
      }
    });

    function repositionIfOpen() {
      if (tooltip.classList.contains('hidden')) return;
      const id = tooltip.dataset.annotationId;
      if (!id) return;
      const hit = document.querySelector('.annotation[data-annotation-id="' + cssEscape(id) + '"]');
      if (hit) showTooltipAt(hit);
    }
    window.addEventListener('resize', repositionIfOpen);
    window.addEventListener('scroll', repositionIfOpen);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initViewer);
  } else {
    initViewer();
  }

})();
