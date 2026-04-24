const fs = require('fs');
let css = fs.readFileSync('viewer.css', 'utf8');

// Also make sure hidden-screen is shown on print
css = css.replace("  .print-annotations {\n    margin-top: 40px;", "  .hidden-screen { display: block !important; }\n  .print-annotations {\n    margin-top: 40px;");
fs.writeFileSync('viewer.css', css);
