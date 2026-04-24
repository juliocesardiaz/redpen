const fs = require('fs');
let js = fs.readFileSync('exporter.js', 'utf8');

// remove the console log
js = js.replace("      console.log('codeHtml length:', codeHtml.length);\n      console.log('first 50 codeHtml:', codeHtml.substring(0, 50));\n", "");

fs.writeFileSync('exporter.js', js);
