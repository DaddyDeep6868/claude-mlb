#!/usr/bin/env node
/*
 * inline-react.js - permanently hard-code React + ReactDOM into index.html.
 *
 * After running this once, the app boots with ZERO network calls for React,
 * so the "[bundle] error" screen can never appear again - even fully offline.
 *
 * Usage (from the project root):
 *   node tools/inline-react.js
 *
 * It uses tools/vendor/react.production.min.js and
 * tools/vendor/react-dom.production.min.js if present (fully offline builds),
 * otherwise it downloads them from the CDN (needs internet just this once).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const VENDOR = path.join(__dirname, 'vendor');

const LIBS = [
  { key: 'react', file: 'react.production.min.js', url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js' },
  { key: 'reactdom', file: 'react-dom.production.min.js', url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js' },
];

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode > 300 && res.statusCode < 400 && res.headers.location) {
        resolve(download(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function getSource(lib) {
  const local = path.join(VENDOR, lib.file);
  if (fs.existsSync(local)) {
    console.log('- using local ' + path.relative(ROOT, local));
    return fs.readFileSync(local, 'utf8');
  }
  console.log('- downloading ' + lib.url);
  return await download(lib.url);
}

// Make arbitrary JS safe to inline inside a <script> tag.
function safeInline(js) { return js.replace(/<\/script/gi, '<\\/script'); }

(async () => {
  let html = fs.readFileSync(INDEX, 'utf8');
  if (html.includes('id="__dc_inlined_react"')) {
    console.log('React is already hard-coded into index.html - nothing to do.');
    return;
  }
  let blocks = '<script id="__dc_inlined_react"></script>\n';
  for (const lib of LIBS) {
    const src = await getSource(lib);
    blocks += '<script id="__dc_inlined_' + lib.key + '">' + safeInline(src) + '</' + 'script>\n';
  }
  const m = html.match(/<head[^>]*>/i);
  if (!m) throw new Error('could not find <head> in index.html');
  const at = m.index + m[0].length;
  html = html.slice(0, at) + '\n' + blocks + html.slice(at);
  fs.writeFileSync(INDEX, html);
  console.log('Done. React + ReactDOM are now hard-coded into index.html.');
  console.log('The app boots with no network dependency - "[bundle] error" is gone for good.');
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
