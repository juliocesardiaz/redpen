const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');

// I notice renderMarkdown and renderInlineMarkdown were actually not fully removed from app.js in my earlier patch because my script failed!
// Let's remove them properly by finding their exact definitions and extracting them.

function removeFunction(source, funcName) {
    const startStr = `  function ${funcName}(`;
    const startIdx = source.indexOf(startStr);
    if (startIdx === -1) return source;

    let bracketCount = 0;
    let endIdx = -1;
    let started = false;

    for (let i = startIdx; i < source.length; i++) {
        if (source[i] === '{') {
            bracketCount++;
            started = true;
        } else if (source[i] === '}') {
            bracketCount--;
        }

        if (started && bracketCount === 0) {
            endIdx = i + 1; // including the '}'
            break;
        }
    }

    if (endIdx !== -1) {
        // Also remove trailing whitespace/newlines
        while (endIdx < source.length && (source[endIdx] === '\n' || source[endIdx] === '\r')) {
            endIdx++;
        }
        return source.substring(0, startIdx) + source.substring(endIdx);
    }
    return source;
}

appJs = removeFunction(appJs, 'renderMarkdown');
appJs = removeFunction(appJs, 'renderInlineMarkdown');

fs.writeFileSync('app.js', appJs);
