#!/usr/bin/env node
/* Inline hr_data.js + hr_engine.js into index.html as self-contained script blocks. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'hr_data.js');
const ENGINE = path.join(ROOT, 'hr_engine.js');
function safeInline(js) { return js.replace(/<\/script/gi, '<\\/script'); }
function upsert(html, id, src) {
  const OPEN = `<script id="${id}">`;
  const CLOSE = '</' + 'script>';
  const block = OPEN + '\n' + safeInline(src) + '\n' + CLOSE;
  const a = html.indexOf(OPEN);
  if (a >= 0) {
    const e = html.indexOf(CLOSE, a) + CLOSE.length;
    return html.slice(0, a) + block + html.slice(e);
  }
  const soccer = html.indexOf('<script id="__dc_soccer">');
  if (soccer >= 0) return html.slice(0, soccer) + block + '\n' + html.slice(soccer);
  let at = html.lastIndexOf('</body>');
  if (at < 0) at = html.lastIndexOf('</html>');
  if (at < 0) return html + '\n' + block + '\n';
  return html.slice(0, at) + block + '\n' + html.slice(at);
}
let html = fs.readFileSync(INDEX, 'utf8');
html = upsert(html, '__dc_hr_data', fs.readFileSync(DATA, 'utf8'));
html = upsert(html, '__dc_hr_engine', fs.readFileSync(ENGINE, 'utf8'));
fs.writeFileSync(INDEX, html);
console.log('Done. HR Engine data + overlay are inlined into index.html.');
