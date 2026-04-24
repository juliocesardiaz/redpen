const fs = require('fs');
let css = fs.readFileSync('viewer.css', 'utf8');

css = css.replace(".hidden { display: none !important; }", ".hidden { display: none !important; }\n.hidden-screen { display: none; }");

fs.writeFileSync('viewer.css', css);
