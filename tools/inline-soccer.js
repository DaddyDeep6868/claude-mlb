#!/usr/bin/env node
/*
 * inline-soccer.js - inline soccer.js into index.html as a self-contained
 * <script> block, so the bundled single-file app ships the Soccer feature
 * with no external file dependency.
 *
 * Idempotent: re-running replaces the existing inlined block with the current
 * soccer.js contents. Run from the project root:
 *   node tools/inline-soccer.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const SOCCER = path.join(ROOT, 'soccer.js');

const OPEN = '<script id="__dc_soccer">';
const CLOSE = '</' + 'script>';

// make arbitrary JS safe to inline inside a <script> tag
function safeInline(js) { return js.replace(/<\/script/gi, '<\\/script'); }

let html = fs.readFileSync(INDEX, 'utf8');
const src = safeInline(fs.readFileSync(SOCCER, 'utf8'));
const block = OPEN + '\n' + src + '\n' + CLOSE;

const a = html.indexOf(OPEN);
if (a >= 0) {
  // replace existing block
  const e = html.indexOf(CLOSE, a) + CLOSE.length;
  html = html.slice(0, a) + block + html.slice(e);
  console.log('- replaced existing soccer block');
} else {
  // insert right before </body> (fallback: before </html>, else append)
  let at = html.lastIndexOf('</body>');
  if (at < 0) at = html.lastIndexOf('</html>');
  if (at < 0) { html = html + '\n' + block + '\n'; }
  else { html = html.slice(0, at) + block + '\n' + html.slice(at); }
  console.log('- inserted soccer block');
}
fs.writeFileSync(INDEX, html);
console.log('Done. Soccer is inlined into index.html.');
