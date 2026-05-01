// redpen — Export to HTML implementation

(function () {
  'use strict';

  // Build the exported HTML string for a single submission. Pure builder:
  // throws on validation failures (missing names, no rendered code, missing
  // assets) so callers can choose how to surface the error. Single-submission
  // export wraps with alert+download; batch export aggregates throws into a
  // failure summary.
  //
  // Batch export drives this through the live #code-lines element rather than
  // rendering off-screen — rendering currently has DOM-only side effects
  // (line wrappers, annotation overlays). A non-DOM render path is a larger
  // refactor; revisit if export-all becomes a hot path.
  function buildExportHtml(submission) {
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
    const hljsMain = A.hljsMain;
    const hljsDiff = A.hljsDiff;

    const codeLinesEl = document.getElementById('code-lines');
    let codeHtml = codeLinesEl ? codeLinesEl.innerHTML : '';
    if (!codeHtml || !codeHtml.trim()) {
      throw new Error('Export aborted: no rendered code found. Render the student\'s code before exporting.');
    }

    const combinedHljs = hljsMain + '\n' + hljsDiff;

    let scoreBlock = '';
    if (submission.score && submission.score.earned !== null && submission.score.total !== null) {
      scoreBlock = `<div class="score">${submission.score.earned} / ${submission.score.total}</div>`;
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

    // Substitute template. Use function-form / manual walk replacements
    // throughout — string-form replace interprets $&, $`, $', $1..$9, $$ in
    // the payload, which mangles regex strings inside the inlined viewer
    // runtime / hljs.
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
      '{{HIGHLIGHT_JS}}': combinedHljs,
      '{{VIEWER_RUNTIME_JS}}': viewerRuntimeJs,
    };
    let outputHtml = template;
    for (const placeholder of Object.keys(subs)) {
      const value = subs[placeholder];
      let out = '';
      let i = 0;
      while (i < outputHtml.length) {
        const idx = outputHtml.indexOf(placeholder, i);
        if (idx === -1) { out += outputHtml.substring(i); break; }
        out += outputHtml.substring(i, idx) + value;
        i = idx + placeholder.length;
      }
      outputHtml = out;
    }

    return outputHtml;
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

  // Caller is responsible for cycling the active submission so #code-lines
  // is populated for each item (see batch caveat in buildExportHtml). We
  // don't render here — we only build per item using whatever's live.
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
