#!/usr/bin/env node
/*
 * inline-react.js - permanently hard-code React + ReactDOM into index.html.
 * Uses locally installed node_modules + esbuild, so it works with no internet.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const TMP_ENTRY = path.join(ROOT, '.inline-react-entry.js');
const TMP_OUT = path.join(ROOT, '.inline-react-bundle.js');

function safeInline(js) { return js.replace(/<\/script/gi, '<\\/script'); }

async function bundleReact() {
  fs.writeFileSync(TMP_ENTRY, `
    import * as React from 'react';
    import * as ReactDOMClient from 'react-dom/client';
    import * as ReactDOMLegacy from 'react-dom';
    window.React = React;
    window.ReactDOM = Object.assign({}, ReactDOMLegacy, ReactDOMClient);
  `);
  await esbuild.build({
    entryPoints: [TMP_ENTRY],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    outfile: TMP_OUT,
    logLevel: 'silent',
  });
  const js = fs.readFileSync(TMP_OUT, 'utf8');
  try { fs.unlinkSync(TMP_ENTRY); } catch (_) {}
  try { fs.unlinkSync(TMP_OUT); } catch (_) {}
  return js;
}

(async () => {
  let html = fs.readFileSync(INDEX, 'utf8');
  // Remove any older inlined React block so reruns are deterministic.
  html = html.replace(/\n?<script id="__dc_inlined_react_bundle">[\s\S]*?<\/script>\n?/g, '\n');
  html = html.replace(/\n?<script id="__dc_inlined_react"><\/script>\n?/g, '\n');
  html = html.replace(/\n?<script id="__dc_inlined_react">[\s\S]*?<\/script>\n?/g, '\n');
  html = html.replace(/\n?<script id="__dc_inlined_reactdom">[\s\S]*?<\/script>\n?/g, '\n');

  const js = await bundleReact();
  const block = '\n<script id="__dc_inlined_react_bundle">' + safeInline(js) + '</' + 'script>\n';
  const m = html.match(/<head[^>]*>/i);
  if (!m) throw new Error('could not find <head> in index.html');
  const at = m.index + m[0].length;
  html = html.slice(0, at) + block + html.slice(at);
  fs.writeFileSync(INDEX, html);
  console.log('Done. React + ReactDOM are embedded locally in index.html.');
})();
