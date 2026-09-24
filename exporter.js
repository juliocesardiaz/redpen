// redpen — Export to HTML implementation

(function () {
  'use strict';

  // The inlined highlight.js bundle never changes after load — concatenate it
  // once instead of per export (backup autosave and batch export call
  // buildExportHtml repeatedly).
  let combinedHljsCache = null;
  function combinedHljs(A) {
    if (combinedHljsCache === null) combinedHljsCache = A.hljsMain + '\n' + A.hljsDiff;
    return combinedHljsCache;
  }

  // Build the exported HTML string for a single submission. Pure builder:
  // throws on validation failures (missing names, no rendered code, missing
  // assets) so callers can choose how to surface the error. Single-submission
  // export wraps with alert+download; batch export aggregates throws into a
  // failure summary.
  //
  // Callers may pass `codeHtml` directly (the innerHTML of a <code> element
  // already populated by R.renderCodeView, possibly off-screen). When omitted,
  // we read the live #code-lines, which is the single-submission UI path.
  function buildExportHtml(submission, codeHtml) {
    if (!submission.studentName || !submission.assignmentName) {
      throw new Error('Add a student name and assignment name before exporting');
    }

    const A = window.RedpenAssets;
    if (!A) {
      throw new Error('Export failed: viewer-assets.js did not load.');
    }
    const template = A.template;
    const viewerCss = A.viewerCss;
    const themeCss = A.themeCss;
    const viewerRuntimeJs = A.viewerRuntime;

    if (codeHtml === undefined) {
      const codeLinesEl = document.getElementById('code-lines');
      codeHtml = codeLinesEl ? codeLinesEl.innerHTML : '';
    }
    if (!codeHtml || !codeHtml.trim()) {
      throw new Error('Export aborted: no rendered code found. Render the student\'s code before exporting.');
    }

    let scoreBlock = '';
    if (submission.score && submission.score.earned !== null && submission.score.total !== null) {
      const tier = scoreTierClass(submission.score);
      scoreBlock = `<div class="score${tier ? ' ' + tier : ''}">${submission.score.earned} / ${submission.score.total}</div>`;
    }

    let overallCommentBlock = '';
    if (submission.overallComment && submission.overallComment.trim() !== '') {
      const renderedComment = window.RedpenShared.renderMarkdown(submission.overallComment);
      overallCommentBlock = `<section class="overall-comment"><div class="markdown-body">${renderedComment}</div></section>`;
    }

    let printAnnotationsHtml = '';
    if (submission.annotations && submission.annotations.length > 0) {
      let printCounter = 1;
      // Insert <sup> markers into the code HTML and build the footnote list.
      // A single annotation can become multiple sibling .annotation spans
      // (hljs token boundaries split them, and multi-line ranges produce one
      // span per line) — only the first segment in document order gets the
      // numbered superscript so the footnote count matches what the reader
      // sees inline.
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = codeHtml;
      const annotationNodes = tempDiv.querySelectorAll('.annotation');

      const idToNumber = {};
      const supPlacedFor = new Set();

      annotationNodes.forEach((node) => {
        const annId = node.dataset.annotationId;
        if (!annId) return;
        if (!(annId in idToNumber)) {
          idToNumber[annId] = printCounter++;
        }
        if (supPlacedFor.has(annId)) return;
        supPlacedFor.add(annId);
        const sup = document.createElement('sup');
        sup.className = 'annotation-sup';
        sup.textContent = idToNumber[annId];
        node.insertBefore(sup, node.firstChild);
      });
      codeHtml = tempDiv.innerHTML;

      const processedIds = new Set();
      submission.annotations.forEach(a => {
        if (!idToNumber[a.id]) return;
        if (processedIds.has(a.id)) return;
        processedIds.add(a.id);

        const num = idToNumber[a.id];

        let tagsHtml = '';
        if (a.tagIds && a.tagIds.length > 0) {
          a.tagIds.forEach(tid => {
            const t = submission.tags.find(tag => tag.id === tid);
            if (t) {
              tagsHtml += `<span class="tag-chip" style="background-color:${t.color};color:#fff;">${window.RedpenShared.escapeHtml(t.label)}</span>`;
            }
          });
        }

        let commentsHtml = '';
        if (a.comments && a.comments.length > 0) {
          a.comments.forEach(c => {
             const text = typeof c === 'string' ? c : (c && c.text) || '';
             commentsHtml += `<div class="markdown-body">${window.RedpenShared.renderMarkdown(text)}</div>`;
          });
        }

        printAnnotationsHtml += `
          <div class="print-annotation">
            <div class="print-annotation-header">
              [${num}] <span class="print-annotation-tags">${tagsHtml}</span>
            </div>
            <div class="print-annotation-body">${commentsHtml}</div>
          </div>`;
      });
    }

    // Escape `</` to prevent breaking out of script tags
    const dataStr = JSON.stringify(submission).replace(/<\//g, '<\\/');

    // Substitute template in ONE pass with a function-form replace —
    // string-form replace would interpret $&, $`, $', $1..$9, $$ in the
    // payload (mangling regex strings inside the inlined viewer runtime /
    // hljs), but a function's return value is inserted verbatim. Single pass
    // also avoids copying the multi-hundred-KB output once per placeholder.
    const subs = {
      '{{ASSIGNMENT_NAME}}': window.RedpenShared.escapeHtml(submission.assignmentName),
      '{{STUDENT_NAME}}': window.RedpenShared.escapeHtml(submission.studentName),
      '{{THEME_STYLES}}': themeCss,
      '{{STYLES}}': viewerCss,
      '{{SCORE_BLOCK}}': scoreBlock,
      '{{OVERALL_COMMENT}}': overallCommentBlock,
      '{{CODE_BODY}}': codeHtml,
      '{{PRINT_ANNOTATIONS}}': printAnnotationsHtml,
      '{{DATA}}': dataStr,
      '{{HIGHLIGHT_JS}}': combinedHljs(A),
      '{{VIEWER_RUNTIME_JS}}': viewerRuntimeJs,
    };
    return template.replace(/\{\{[A-Z_]+\}\}/g, function (placeholder) {
      return placeholder in subs ? subs[placeholder] : placeholder;
    });
  }

  // Soft color tier for the viewer's score badge. Neutral (no class) when
  // the ratio can't be computed, so a missing or zero total never renders
  // a colored badge.
  function scoreTierClass(score) {
    const earned = Number(score.earned);
    const total = Number(score.total);
    if (!Number.isFinite(earned) || !Number.isFinite(total) || total <= 0) return '';
    const ratio = earned / total;
    if (ratio >= 0.8) return 'score-high';
    if (ratio >= 0.5) return 'score-mid';
    return 'score-low';
  }

  function slugifyPart(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  function slugForSubmission(submission) {
    const safeStudent = slugifyPart(submission.studentName) || 'student';
    const safeAssignment = slugifyPart(submission.assignmentName) || 'assignment';
    return `${safeStudent}_${safeAssignment}_redpen`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportSubmission(submission) {
    let html;
    try {
      html = buildExportHtml(submission);
    } catch (e) {
      console.error('Export failed:', e);
      alert(e.message);
      return;
    }
    const filename = slugForSubmission(submission) + '.html';
    const blob = new Blob([html], { type: 'text/html' });
    downloadBlob(blob, filename);
  }

  async function exportZipFromBuiltEntries(entries, filename) {
    if (!window.JSZip) {
      alert('Batch export unavailable: JSZip did not load.');
      return;
    }
    const zip = new window.JSZip();
    for (const e of entries) {
      zip.file(e.filename, e.html);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const finalName = filename || `redpen_batch_${new Date().toISOString().slice(0, 10)}.zip`;
    downloadBlob(blob, finalName);
  }

  // Expose
  window.buildExportHtml = buildExportHtml;
  window.slugifyPart = slugifyPart;
  window.slugForSubmission = slugForSubmission;
  window.exportSubmission = exportSubmission;
  window.exportZipFromBuiltEntries = exportZipFromBuiltEntries;

})();
