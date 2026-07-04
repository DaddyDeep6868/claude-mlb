#!/usr/bin/env node
/*
 * set-version.js - update the version string everywhere at once.
 * Updates the on-screen UI badge (index.html + DingerLab Redesign.dc.html)
 * and the README title.
 *
 * Usage (from the project root):
 *   node tools/set-version.js 1.0.3
 *
 * Then re-zip and name the archive DingerLab_v1.0.3_StadiumNight.zip
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const raw = process.argv[2];
if (!raw || !/^\d+\.\d+\.\d+$/.test(raw)) {
  console.error('Usage: node tools/set-version.js X.Y.Z   (e.g. 1.0.3)');
  process.exit(1);
}
const TAG = 'v' + raw;
const P = (f) => path.join(ROOT, f);

// matches the on-screen version badge like >v1.2.3<
function bumpBadge(text) { return text.replace(/>v\d+\.\d+\.\d+</g, '>' + TAG + '<'); }

// 1) dc source
{
  const p = P('DingerLab Redesign.dc.html');
  fs.writeFileSync(p, bumpBadge(fs.readFileSync(p, 'utf8')));
  console.log('- updated DingerLab Redesign.dc.html');
}

// 2) README
{
  const p = P('README.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/v\d+\.\d+\.\d+/, TAG));
  console.log('- updated README.md');
}

// 3) index.html (bundled) - version lives inside the encoded template string
{
  const p = P('index.html');
  let html = fs.readFileSync(p, 'utf8');
  const TAGOPEN = '<script type="__bundler/template">';
  const a = html.indexOf(TAGOPEN);
  if (a < 0) throw new Error('template block not found in index.html');
  const s = a + TAGOPEN.length;
  const e = html.indexOf('</scr' + 'ipt>', s);
  const seg = html.slice(s, e);
  let tpl = JSON.parse(seg);
  tpl = bumpBadge(tpl);
  const encoded = JSON.stringify(tpl).split('</').join('<\\u002F');
  html = html.slice(0, s) + encoded + html.slice(e);
  fs.writeFileSync(p, html);
  console.log('- updated index.html');
}

console.log('Version set to ' + TAG + '. Name the zip DingerLab_' + TAG + '_StadiumNight.zip');
