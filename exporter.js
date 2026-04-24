// redpen — Export to HTML implementation

(function () {
  'use strict';

  async function exportSubmission(submission) {
    if (!submission.studentName || !submission.assignmentName) {
      alert('Add a student name and assignment name before exporting');
      return;
    }

    try {
      // 1. Fetch required assets
      const assets = await Promise.all([
        fetch('viewer-template.html').then(r => r.text()),
        fetch('viewer.css').then(r => r.text()),
        fetch('vendor/highlight-theme.css').then(r => r.text()),
        fetch('viewer-runtime.js').then(r => r.text()),
        fetch('vendor/highlight.min.js').then(r => r.text()),
        fetch('vendor/highlight-diff.min.js').then(r => r.text())
      ]);

      const [template, viewerCss, themeCss, viewerRuntimeJs, hljsMain, hljsDiff] = assets;

      let codeHtml = document.getElementById('code-lines') ? document.getElementById('code-lines').innerHTML : '';

      const combinedHljs = hljsMain + '\n' + hljsDiff;

      // 2. Generate the rendered code HTML
      // 3. Generate Header info
      let scoreBlock = '';
      if (submission.score && submission.score.earned !== null && submission.score.total !== null) {
        scoreBlock = `<div class="score">${submission.score.earned} / ${submission.score.total}</div>`;
      }

      // 4. Generate Overall Comment
      let overallCommentBlock = '';
      if (submission.overallComment && submission.overallComment.trim() !== '') {
        const renderedComment = window.RedpenShared.renderMarkdown(submission.overallComment);
        overallCommentBlock = `<section class="overall-comment"><div class="markdown-body">${renderedComment}</div></section>`;
      }

      // 5. Generate Print Annotations
      let printAnnotationsHtml = '';
      if (submission.annotations && submission.annotations.length > 0) {
        let printCounter = 1;
        // In the author mode, annotations are rendered with spans, but we need to inject the `<sup>` markers for printing into `codeHtml`
        // However, instead of modifying `codeHtml` which is complex, we'll just output the print annotations at the bottom. The spec says:
        // "Print all annotations expanded as footnotes after the code, numbered to match small superscript markers next to each annotation in the code"
        // Wait, we need to inject `<sup>` tags into `codeHtml` inside each annotation span!
        // We can do this with a quick regex on codeHtml or by parsing it with DOM.
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = codeHtml;
        const annotationNodes = tempDiv.querySelectorAll('.annotation');

        let idToNumber = {};

        annotationNodes.forEach((node) => {
          const annId = node.dataset.annotationId;
          if (annId) {
            if (!idToNumber[annId]) {
              idToNumber[annId] = printCounter++;
            }
            // Only add superscript to the first part of an annotation (some annotations span multiple lines)
            if (!node.querySelector('.annotation-sup')) {
              const sup = document.createElement('sup');
              sup.className = 'annotation-sup';
              sup.textContent = idToNumber[annId];
              // insert at start
              node.insertBefore(sup, node.firstChild);
            }
          }
        });
        codeHtml = tempDiv.innerHTML;

        // Generate the footnotes list
        const processedIds = new Set();
        submission.annotations.forEach(a => {
          if (!idToNumber[a.id]) return; // Or use the annotation directly
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

      // 6. Embed Submission Data
      // Escape `</` to prevent breaking out of script tags
      const dataStr = JSON.stringify(submission).replace(/<\//g, '<\\/');

      // 7. Substitute template
      const outputHtml = template
        .replaceAll('{{ASSIGNMENT_NAME}}', window.RedpenShared.escapeHtml(submission.assignmentName))
        .replaceAll('{{STUDENT_NAME}}', window.RedpenShared.escapeHtml(submission.studentName))
        .replace('{{THEME_STYLES}}', themeCss)
        .replace('{{STYLES}}', viewerCss)
        .replace('{{SCORE_BLOCK}}', scoreBlock)
        .replace('{{OVERALL_COMMENT}}', overallCommentBlock)
        .replace('{{CODE_BODY}}', codeHtml)
        .replace('{{PRINT_ANNOTATIONS}}', printAnnotationsHtml)
        .replace('{{DATA}}', dataStr)
        .replace('{{HIGHLIGHT_JS}}', combinedHljs)
        .replace('{{VIEWER_RUNTIME_JS}}', viewerRuntimeJs);

      // 8. Generate Filename
      const safeStudent = submission.studentName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const safeAssignment = submission.assignmentName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      const finalStudent = safeStudent || 'student';
      const finalAssignment = safeAssignment || 'assignment';
      const filename = `${finalStudent}_${finalAssignment}_redpen.html`;

      // 9. Download
      const blob = new Blob([outputHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (e) {
      console.error('Export failed:', e);
      alert('Failed to export HTML. Check console for details.');
    }
  }

  // Expose
  window.exportSubmission = exportSubmission;

})();
