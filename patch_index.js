const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

html = html.replace("var s1 = document.createElement('script');\n        s1.src = 'viewer-runtime.js';\n        s1.defer = false;\n        document.head.appendChild(s1);",
"var s1 = document.createElement('script');\n        s1.src = 'viewer-runtime.js';\n        s1.async = false;\n        s1.defer = false;\n        document.head.appendChild(s1);");

html = html.replace("var s2 = document.createElement('script');\n        s2.src = 'exporter.js';\n        s2.defer = false;\n        document.head.appendChild(s2);",
"var s2 = document.createElement('script');\n        s2.src = 'exporter.js';\n        s2.async = false;\n        s2.defer = false;\n        document.head.appendChild(s2);");

html = html.replace("var s = document.createElement('script');\n        s.src = 'app.js';\n        s.defer = false;\n        document.head.appendChild(s);",
"var s = document.createElement('script');\n        s.src = 'app.js';\n        s.async = false;\n        s.defer = false;\n        document.head.appendChild(s);");

fs.writeFileSync('index.html', html);
