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
    renderMarkdown: renderMarkdown,
    positionTooltip: positionTooltip,
    resolveAnnotationFromTarget: resolveAnnotationFromTarget,
    wireHoverSync: wireHoverSync,
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
    wireCopyButton();
    wireAnnotations();
  }

  function getAnnotationById(id) {
    if (!submission) return null;
    for (let i = 0; i < submission.annotations.length; i++) {
      if (submission.annotations[i].id === id) return submission.annotations[i];
    }
    return null;
  }

  function getTagById(id) {
    if (!submission) return null;
    for (let i = 0; i < submission.tags.length; i++) {
      if (submission.tags[i].id === id) return submission.tags[i];
    }
    return null;
  }

  function closeTooltip() {
    tooltip.classList.add('hidden');
    tooltip.dataset.annotationId = '';
  }

  function populateTooltip(annotationId) {
    const a = getAnnotationById(annotationId);
    if (!a) return;

    tooltipContent.innerHTML = '';

    if (a.tagIds && a.tagIds.length > 0) {
      const row = document.createElement('div');
      row.className = 'tooltip-tags';
      for (let i = 0; i < a.tagIds.length; i++) {
        const t = getTagById(a.tagIds[i]);
        if (t) {
          const pill = document.createElement('span');
          pill.className = 'tag-chip';
          pill.style.backgroundColor = t.color;
          pill.style.color = '#fff';
          pill.textContent = t.label;
          row.appendChild(pill);
        }
      }
      if (row.children.length > 0) tooltipContent.appendChild(row);
    }

    if (a.comments && a.comments.length > 0) {
      for (let i = 0; i < a.comments.length; i++) {
        if (i > 0) {
          const hr = document.createElement('hr');
          hr.className = 'tooltip-divider';
          tooltipContent.appendChild(hr);
        }
        const body = document.createElement('div');
        body.className = 'tooltip-comment markdown-body';
        const c = a.comments[i];
        const text = typeof c === 'string' ? c : (c && c.text) || '';
        body.innerHTML = renderMarkdown(text);
        tooltipContent.appendChild(body);
      }
    }
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
      }
    });

    wireHoverSync(codeView, getAnnotationById);
  }

  function wireTooltip() {
    document.addEventListener('click', function (e) {
      if (tooltip.classList.contains('hidden')) return;
      if (tooltip.contains(e.target)) return;

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

  function wireCopyButton() {
    document.addEventListener('click', function (e) {
      if (e.target && e.target.classList.contains('md-code-copy')) {
        const pre = e.target.nextElementSibling;
        if (pre && pre.tagName === 'PRE') {
          navigator.clipboard.writeText(pre.textContent).then(function () {
            const btn = e.target;
            const old = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(function () { btn.textContent = old; }, 2000);
          });
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initViewer);
  } else {
    initViewer();
  }

})();
