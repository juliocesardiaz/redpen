// Shared runtime for redpen viewer

(function () {
  'use strict';

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Same as author mode
  function renderMarkdown(source) {
    if (!source) return '';
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
          if (window.hljs && codeLang) {
            try {
              out += window.hljs.highlight(codeBlock, { language: codeLang }).value;
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
    // [text](url)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out;
  }

  // Expose to window for author mode to use as well
  window.RedpenShared = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    renderMarkdown: renderMarkdown
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
        body.innerHTML = renderMarkdown(a.comments[i]);
        tooltipContent.appendChild(body);
      }
    }
  }

  function positionTooltip(targetEl) {
    const tt = tooltip;
    tt.classList.remove('hidden');

    const targetRect = targetEl.getBoundingClientRect();
    const ttRect = tt.getBoundingClientRect();

    const padding = 12;
    let top = targetRect.bottom + padding;
    let placement = 'below';

    if (top + ttRect.height > window.innerHeight && targetRect.top - ttRect.height - padding > 0) {
      top = targetRect.top - ttRect.height - padding;
      placement = 'above';
    }

    let left = targetRect.left;
    if (left + ttRect.width > window.innerWidth - padding) {
      left = window.innerWidth - ttRect.width - padding;
    }
    if (left < padding) {
      left = padding;
    }

    tt.style.top = top + 'px';
    tt.style.left = left + 'px';
    tt.dataset.placement = placement;

    const arrow = tt.querySelector('.tooltip-arrow');
    if (arrow) {
      let arrowLeft = targetRect.left + (targetRect.width / 2) - left;
      if (arrowLeft < 16) arrowLeft = 16;
      if (arrowLeft > ttRect.width - 16) arrowLeft = ttRect.width - 16;
      arrow.style.left = arrowLeft + 'px';
    }
  }

  function wireAnnotations() {
    const codeView = document.querySelector('.code-view');
    if (!codeView) return;

    codeView.addEventListener('click', function(e) {
      const hit = e.target.closest('.annotation');
      if (!hit) return;

      const id = hit.dataset.annotationId;
      if (!id) return;

      e.stopPropagation();

      if (tooltip.dataset.annotationId === id && !tooltip.classList.contains('hidden')) {
        closeTooltip();
      } else {
        tooltip.dataset.annotationId = id;
        populateTooltip(id);
        positionTooltip(hit);
      }
    });
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

    window.addEventListener('resize', function () {
      if (tooltip.classList.contains('hidden')) return;
      const id = tooltip.dataset.annotationId;
      if (id) {
        const hit = document.querySelector('.annotation[data-annotation-id="' + id + '"]');
        if (hit) positionTooltip(hit);
      }
    });

    window.addEventListener('scroll', function () {
      if (tooltip.classList.contains('hidden')) return;
      const id = tooltip.dataset.annotationId;
      if (id) {
        const hit = document.querySelector('.annotation[data-annotation-id="' + id + '"]');
        if (hit) positionTooltip(hit);
      }
    });
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
