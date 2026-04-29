#!/usr/bin/env node
// Regenerate viewer-assets.js by inlining the source viewer files as
// JSON-encoded string literals on window.RedpenAssets. The exporter relies
// on this bundle so file:// installs can run without fetch().
//
// Run after editing any of: viewer-template.html, viewer.css,
// viewer-runtime.js, or the bundled vendor assets.

const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const assets = {
  template: read('viewer-template.html'),
  themeCss: read('vendor/highlight-theme.css'),
  viewerCss: read('viewer.css'),
  viewerRuntime: read('viewer-runtime.js'),
  hljsMain: read('vendor/highlight.min.js'),
  hljsDiff: read('vendor/highlight-diff.min.js'),
};

const lines = [
  '// Viewer assets inlined as strings so the exporter works from file://',
  '// without fetch() (which browsers block for local files). Edit the source',
  '// files and re-run build-viewer-assets.js to regenerate this bundle.',
  '',
  '(function () {',
  '  window.RedpenAssets = {};',
];
for (const [key, value] of Object.entries(assets)) {
  lines.push(`  window.RedpenAssets.${key} = ${JSON.stringify(value)};`);
}
lines.push('})();', '');

fs.writeFileSync(path.join(root, 'viewer-assets.js'), lines.join('\n'));
console.log('Wrote viewer-assets.js');
