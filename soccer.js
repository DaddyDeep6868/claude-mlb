/*
 * soccer.js - DingerLab Soccer (World Cup 2026) module.
 *
 * Self-contained, dependency-free (no React needed). It injects a top-level
 * MLB <-> Soccer switcher and a full-screen soccer view layered over the
 * existing baseball app, without touching the compiled dc template.
 *
 * Markets modelled: Anytime Goalscorer (the home-run analog), Match Result
 * (1X2), Over/Under 2.5 Goals, and Corners.
 */
(function () {
  'use strict';
  if (window.__DL_SOCCER__) return;
  window.__DL_SOCCER__ = true;

  var AC = '#2ee6a6';      // soccer accent (green) to distinguish the mode
  var POS = '#35d0c0';
  var WARN = '#ffc24d';
  var BG = '#0a0c11';
  var TXT = '#eef1f6';
  var MUT = '#7b8597';
  var LEAGUE = (window.DL_SOCCER_LEAGUE || 'world_cup');

  // ---------------------------------------------------------------- helpers
  function seed(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fact(n) { var f = 1; for (var i = 2; i <= n; i++) f *= i; return f; }
  function pois(k, l) { return Math.exp(-l) * Math.pow(l, k) / fact(k); }
  function poisAtMost(k, l) { var s = 0; for (var i = 0; i <= k; i++) s += pois(i, l); return s; }
  function americanFromProb(p) { p = clamp(p, 0.01, 0.985); return p >= 0.5 ? Math.round(-(p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100); }
  function profitPer100(am) { return am > 0 ? am : 10000 / (-am); }
  function fmtAm(am) { return (am > 0 ? '+' : '') + am; }
  function pct(p) { return (p * 100).toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // Build a synthetic market line around a model probability, with a
  // deterministic per-selection margin so some selections carry real edge.
  function market(modelProb, key) {
    var margin = (seed(key) - 0.42) * 0.22;            // ~ -0.09 .. +0.13
    var bookProb = clamp(modelProb * (1 + margin), 0.02, 0.96);
    var am = americanFromProb(bookProb);
    var edge = modelProb - bookProb;                   // + = value
    var ev = modelProb * profitPer100(am) - (1 - modelProb) * 100;
    var score = clamp(Math.round(38 + edge * 340 + modelProb * 46), 1, 99);
    return { am: am, bookProb: bookProb, edge: edge, ev: ev, score: score };
  }

  // ---------------------------------------------------------------- data (WC 2026 sample slate)
  // atk: attacking strength (1.0 avg). def: defensive solidity (higher = better).
  var TEAMS = {
    ARG: { name: 'Argentina', flag: '\uD83C\uDDE6\uD83C\uDDF7', atk: 1.42, def: 1.30, corners: 5.6 },
    FRA: { name: 'France', flag: '\uD83C\uDDEB\uD83C\uDDF7', atk: 1.48, def: 1.28, corners: 5.9 },
    BRA: { name: 'Brazil', flag: '\uD83C\uDDE7\uD83C\uDDF7', atk: 1.44, def: 1.22, corners: 6.2 },
    ENG: { name: 'England', flag: '\uD83C\uDDEC\uD83C\uDDE7', atk: 1.38, def: 1.26, corners: 6.0 },
    ESP: { name: 'Spain', flag: '\uD83C\uDDEA\uD83C\uDDF8', atk: 1.46, def: 1.24, corners: 6.6 },
    POR: { name: 'Portugal', flag: '\uD83C\uDDF5\uD83C\uDDF9', atk: 1.40, def: 1.18, corners: 6.1 },
    NED: { name: 'Netherlands', flag: '\uD83C\uDDF3\uD83C\uDDF1', atk: 1.30, def: 1.20, corners: 5.4 },
    GER: { name: 'Germany', flag: '\uD83C\uDDE9\uD83C\uDDEA', atk: 1.34, def: 1.16, corners: 6.3 },
    USA: { name: 'USA', flag: '\uD83C\uDDFA\uD83C\uDDF8', atk: 1.08, def: 1.05, corners: 4.8 },
    MEX: { name: 'Mexico', flag: '\uD83C\uDDF2\uD83C\uDDFD', atk: 1.05, def: 1.02, corners: 4.9 },
    CAN: { name: 'Canada', flag: '\uD83C\uDDE8\uD83C\uDDE6', atk: 1.02, def: 0.98, corners: 4.6 },
    URU: { name: 'Uruguay', flag: '\uD83C\uDDFA\uD83C\uDDFE', atk: 1.18, def: 1.14, corners: 5.0 },
    CRO: { name: 'Croatia', flag: '\uD83C\uDDED\uD83C\uDDF7', atk: 1.14, def: 1.12, corners: 5.1 },
    BEL: { name: 'Belgium', flag: '\uD83C\uDDE7\uD83C\uDDEA', atk: 1.22, def: 1.08, corners: 5.3 },
    MAR: { name: 'Morocco', flag: '\uD83C\uDDF2\uD83C\uDDE6', atk: 1.10, def: 1.20, corners: 4.7 },
    JPN: { name: 'Japan', flag: '\uD83C\uDDEF\uD83C\uDDF5', atk: 1.06, def: 1.04, corners: 4.9 }
  };

  // threat: per-match goal threat (0..~0.8). min: minutes share (0..1).
  var PLAYERS = [
    { n: 'Lionel Messi', t: 'ARG', pos: 'FW', threat: 0.62, min: 0.90 },
    { n: 'Julian Alvarez', t: 'ARG', pos: 'FW', threat: 0.58, min: 0.92 },
    { n: 'Lautaro Martinez', t: 'ARG', pos: 'FW', threat: 0.55, min: 0.80 },
    { n: 'Kylian Mbappe', t: 'FRA', pos: 'FW', threat: 0.78, min: 0.94 },
    { n: 'Ousmane Dembele', t: 'FRA', pos: 'FW', threat: 0.48, min: 0.82 },
    { n: 'Vinicius Jr', t: 'BRA', pos: 'FW', threat: 0.60, min: 0.90 },
    { n: 'Rodrygo', t: 'BRA', pos: 'FW', threat: 0.50, min: 0.85 },
    { n: 'Endrick', t: 'BRA', pos: 'FW', threat: 0.46, min: 0.60 },
    { n: 'Harry Kane', t: 'ENG', pos: 'FW', threat: 0.70, min: 0.95 },
    { n: 'Jude Bellingham', t: 'ENG', pos: 'MF', threat: 0.52, min: 0.92 },
    { n: 'Bukayo Saka', t: 'ENG', pos: 'FW', threat: 0.46, min: 0.88 },
    { n: 'Lamine Yamal', t: 'ESP', pos: 'FW', threat: 0.54, min: 0.88 },
    { n: 'Alvaro Morata', t: 'ESP', pos: 'FW', threat: 0.50, min: 0.80 },
    { n: 'Nico Williams', t: 'ESP', pos: 'FW', threat: 0.44, min: 0.82 },
    { n: 'Cristiano Ronaldo', t: 'POR', pos: 'FW', threat: 0.56, min: 0.85 },
    { n: 'Bruno Fernandes', t: 'POR', pos: 'MF', threat: 0.44, min: 0.90 },
    { n: 'Rafael Leao', t: 'POR', pos: 'FW', threat: 0.46, min: 0.78 },
    { n: 'Cody Gakpo', t: 'NED', pos: 'FW', threat: 0.48, min: 0.85 },
    { n: 'Memphis Depay', t: 'NED', pos: 'FW', threat: 0.46, min: 0.72 },
    { n: 'Jamal Musiala', t: 'GER', pos: 'MF', threat: 0.50, min: 0.90 },
    { n: 'Kai Havertz', t: 'GER', pos: 'FW', threat: 0.46, min: 0.84 },
    { n: 'Florian Wirtz', t: 'GER', pos: 'MF', threat: 0.44, min: 0.86 },
    { n: 'Christian Pulisic', t: 'USA', pos: 'FW', threat: 0.42, min: 0.90 },
    { n: 'Folarin Balogun', t: 'USA', pos: 'FW', threat: 0.38, min: 0.80 },
    { n: 'Santiago Gimenez', t: 'MEX', pos: 'FW', threat: 0.40, min: 0.82 },
    { n: 'Jonathan David', t: 'CAN', pos: 'FW', threat: 0.42, min: 0.88 },
    { n: 'Alphonso Davies', t: 'CAN', pos: 'DF', threat: 0.26, min: 0.90 },
    { n: 'Darwin Nunez', t: 'URU', pos: 'FW', threat: 0.48, min: 0.85 },
    { n: 'Federico Valverde', t: 'URU', pos: 'MF', threat: 0.36, min: 0.92 },
    { n: 'Andrej Kramaric', t: 'CRO', pos: 'FW', threat: 0.38, min: 0.78 },
    { n: 'Romelu Lukaku', t: 'BEL', pos: 'FW', threat: 0.50, min: 0.85 },
    { n: 'Kevin De Bruyne', t: 'BEL', pos: 'MF', threat: 0.42, min: 0.86 },
    { n: 'Youssef En-Nesyri', t: 'MAR', pos: 'FW', threat: 0.40, min: 0.84 },
    { n: 'Kaoru Mitoma', t: 'JPN', pos: 'FW', threat: 0.36, min: 0.86 }
  ];

  function mkMatch(h, a, iso, stage, venue) { return { h: h, a: a, iso: iso, stage: stage, venue: venue }; }
  var MATCHES = [
    mkMatch('ARG', 'CRO', '2026-07-05T16:00:00-04:00', 'Round of 16', 'MetLife, NJ'),
    mkMatch('FRA', 'MAR', '2026-07-05T20:00:00-04:00', 'Round of 16', 'AT&T, Dallas'),
    mkMatch('BRA', 'URU', '2026-07-06T16:00:00-04:00', 'Round of 16', 'SoFi, LA'),
    mkMatch('ENG', 'JPN', '2026-07-06T20:00:00-04:00', 'Round of 16', 'Arrowhead, KC'),
    mkMatch('ESP', 'MEX', '2026-07-07T16:00:00-04:00', 'Round of 16', 'Azteca, Mexico City'),
    mkMatch('POR', 'USA', '2026-07-07T20:00:00-04:00', 'Round of 16', 'Levi\'s, SF'),
    mkMatch('NED', 'CAN', '2026-07-08T16:00:00-04:00', 'Round of 16', 'BMO, Toronto'),
    mkMatch('GER', 'BEL', '2026-07-08T20:00:00-04:00', 'Round of 16', 'Gillette, Boston')
  ];

  // ---------------------------------------------------------------- models
  function goalscorers() {
    // map each player to their next fixture opponent
    var oppOf = {};
    MATCHES.forEach(function (m) { oppOf[m.h] = { opp: m.a, home: true, m: m }; oppOf[m.a] = { opp: m.h, home: false, m: m }; });
    var out = [];
    PLAYERS.forEach(function (p) {
      var fx = oppOf[p.t]; if (!fx) return;
      var team = TEAMS[p.t], opp = TEAMS[fx.opp];
      var lam = p.threat * (team.atk / opp.def) * p.min * (fx.home ? 1.06 : 0.97);
      var prob = clamp(1 - Math.exp(-lam), 0.03, 0.85);
      var mk = market(prob, 'gs' + p.n);
      out.push({
        name: p.n, team: p.t, teamName: team.name, flag: team.flag, pos: p.pos,
        opp: fx.opp, oppName: opp.name, home: fx.home, stage: fx.m.stage,
        prob: prob, am: mk.am, edge: mk.edge, ev: mk.ev, score: mk.score,
        init: p.n.split(' ').map(function (w) { return w[0]; }).slice(-2).join('')
      });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  function matchModel(m) {
    var H = TEAMS[m.h], A = TEAMS[m.a];
    var BASE = 1.35;
    var xgH = BASE * (H.atk / A.def) * 1.08;
    var xgA = BASE * (A.atk / H.def) * 0.95;
    var pH = 0, pD = 0, pA = 0, N = 8;
    for (var i = 0; i <= N; i++) for (var j = 0; j <= N; j++) {
      var pr = pois(i, xgH) * pois(j, xgA);
      if (i > j) pH += pr; else if (i === j) pD += pr; else pA += pr;
    }
    var tot = xgH + xgA;
    var over25 = 1 - poisAtMost(2, tot);
    var btts = (1 - poisAtMost(0, xgH)) * (1 - poisAtMost(0, xgA));
    var cxTot = H.corners * (H.atk / A.def) + A.corners * (A.atk / H.def);
    var over95c = 1 - poisAtMost(9, cxTot);
    return {
      xgH: xgH, xgA: xgA, pH: pH, pD: pD, pA: pA, over25: over25, under25: 1 - over25,
      btts: btts, cxTot: cxTot, over95c: over95c, under95c: 1 - over95c
    };
  }

  // ---------------------------------------------------------------- state + UI
  var state = { tab: 'radar', teamFilter: '' };
  var overlay = null;

  function scoreColor(s) { return s >= 70 ? AC : s >= 55 ? WARN : MUT; }
  function evColor(ev) { return ev > 5 ? POS : ev < -8 ? '#ff6b6b' : MUT; }
  function edgeBadge(edge) {
    if (edge >= 0.05) return '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(46,230,166,.16);color:' + AC + '">VALUE</span>';
    if (edge <= -0.06) return '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(255,107,107,.14);color:#ff6b6b">FADE</span>';
    return '';
  }

  function tabBtn(id, label) {
    var on = state.tab === id;
    return '<button data-act="tab" data-tab="' + id + '" style="padding:8px 15px;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (on ? AC : 'transparent') + ';color:' + (on ? '#06231a' : MUT) + '">' + label + '</button>';
  }

  function renderRadar() {
    var all = goalscorers();
    var teams = Object.keys(TEAMS).filter(function (t) { return all.some(function (p) { return p.team === t; }); }).sort();
    var chips = '<button data-act="team" data-team="" style="padding:6px 12px;border-radius:20px;cursor:pointer;font-family:inherit;font-weight:700;font-size:12px;border:1px solid ' + (state.teamFilter === '' ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (state.teamFilter === '' ? AC : '#13161e') + ';color:' + (state.teamFilter === '' ? '#06231a' : MUT) + '">All</button>';
    chips += teams.map(function (t) { var on = state.teamFilter === t; return '<button data-act="team" data-team="' + t + '" style="padding:6px 12px;border-radius:20px;cursor:pointer;font-family:inherit;font-weight:700;font-size:12px;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (on ? AC : '#13161e') + ';color:' + (on ? '#06231a' : MUT) + '">' + TEAMS[t].flag + ' ' + t + '</button>'; }).join('');
    var list = state.teamFilter ? all.filter(function (p) { return p.team === state.teamFilter; }) : all;
    var top = list.filter(function (p) { return p.score >= 68; }).slice(0, 4);

    var cards = list.map(function (p) {
      return '<div style="background:#13161e;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:15px;display:flex;flex-direction:column;gap:12px">'
        + '<div style="display:flex;align-items:center;gap:12px">'
        + '<div style="width:52px;height:52px;flex:none;border-radius:50%;background:#0c0e14;display:grid;place-items:center;font-family:inherit;font-weight:800;font-size:16px;color:' + AC + '">' + esc(p.init) + '</div>'
        + '<div style="min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-weight:700;font-size:15px">' + esc(p.name) + '</span>' + edgeBadge(p.edge) + '</div>'
        + '<div style="font-size:12px;color:' + MUT + ';margin-top:2px">' + p.flag + ' ' + esc(p.teamName) + ' ' + (p.home ? 'vs' : '@') + ' ' + esc(p.oppName) + ' \u00B7 ' + esc(p.pos) + '</div></div>'
        + '<div style="margin-left:auto;text-align:center"><div style="font-size:10px;color:' + MUT + ';font-weight:700">SCORE</div><div style="font-family:inherit;font-weight:800;font-size:22px;color:' + scoreColor(p.score) + '">' + p.score + '</div></div>'
        + '</div>'
        + '<div style="display:flex;gap:8px">'
        + statCell('Goal \u00B7 model', pct(p.prob), TXT)
        + statCell('Anytime', fmtAm(p.am), scoreColor(p.score))
        + statCell('EV /$100', (p.ev > 0 ? '+' : '') + p.ev.toFixed(1), evColor(p.ev))
        + '</div></div>';
    }).join('');

    return '<div style="margin-bottom:16px">' + (top.length ? topStrip(top) : '')
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 6px">' + chips + '</div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + cards + '</div>';
  }

  function statCell(label, val, color) {
    return '<div style="flex:1;background:#0c0e14;border:1px solid rgba(255,255,255,.06);border-radius:11px;padding:8px 10px"><div style="font-size:10px;color:' + MUT + ';font-weight:700">' + label + '</div><div style="font-family:inherit;font-weight:800;font-size:16px;color:' + color + '">' + val + '</div></div>';
  }

  function topStrip(top) {
    return '<div style="background:linear-gradient(150deg,rgba(46,230,166,.10),rgba(53,208,192,.04));border:1px solid rgba(46,230,166,.22);border-radius:16px;padding:14px 16px">'
      + '<div style="font-family:inherit;font-weight:800;font-size:13px;color:' + AC + ';margin-bottom:10px">\u2605 TOP VALUE PICKS</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">'
      + top.map(function (p) { return '<div style="background:#0c0e14;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 12px"><div style="font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</div><div style="font-size:11.5px;color:' + MUT + ';margin:3px 0">Anytime ' + fmtAm(p.am) + ' \u00B7 ' + pct(p.prob) + '</div><div style="font-family:inherit;font-weight:800;font-size:18px;color:' + AC + '">' + p.score + '</div></div>'; }).join('')
      + '</div></div>';
  }

  function probBar(label, p, color) {
    return '<div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:11px;color:' + MUT + ';font-weight:700;margin-bottom:4px"><span>' + label + '</span><span style="color:' + color + '">' + Math.round(p * 100) + '%</span></div>'
      + '<div style="height:6px;border-radius:4px;background:#0c0e14;overflow:hidden"><div style="height:100%;width:' + Math.round(p * 100) + '%;background:' + color + '"></div></div></div>';
  }

  function oddRow(label, prob, key) {
    var mk = market(prob, key);
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:10px;background:#0c0e14;border:1px solid rgba(255,255,255,.06)">'
      + '<div style="font-size:12.5px;font-weight:600">' + label + ' ' + edgeBadge(mk.edge) + '</div>'
      + '<div style="display:flex;gap:14px;align-items:center">'
      + '<span style="font-size:12px;color:' + MUT + '">' + pct(prob) + '</span>'
      + '<span style="font-family:inherit;font-weight:800;font-size:15px;color:' + scoreColor(mk.score) + '">' + fmtAm(mk.am) + '</span>'
      + '<span style="font-size:11.5px;color:' + evColor(mk.ev) + ';font-weight:700;width:52px;text-align:right">' + (mk.ev > 0 ? '+' : '') + mk.ev.toFixed(1) + '</span>'
      + '</div></div>';
  }

  function matchCard(m, opts) {
    var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a];
    var d = new Date(m.iso);
    var when = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' \u00B7 ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    var head = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
      + '<div><div style="font-weight:800;font-size:16px">' + H.flag + ' ' + esc(H.name) + ' <span style="color:' + MUT + '">v</span> ' + esc(A.name) + ' ' + A.flag + '</div>'
      + '<div style="font-size:11.5px;color:' + MUT + ';margin-top:3px">' + esc(m.stage) + ' \u00B7 ' + when + ' \u00B7 ' + esc(m.venue) + '</div></div>'
      + '<div style="text-align:right"><div style="font-size:10px;color:' + MUT + ';font-weight:700">xG</div><div style="font-family:inherit;font-weight:800;font-size:15px">' + mm.xgH.toFixed(2) + ' - ' + mm.xgA.toFixed(2) + '</div></div></div>';
    var body = '';
    if (opts.corners) {
      body = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="font-size:12px;color:' + MUT + '">Projected total corners</div><div style="font-family:inherit;font-weight:800;font-size:16px;color:' + AC + '">' + mm.cxTot.toFixed(1) + '</div></div>'
        + '<div style="display:flex;flex-direction:column;gap:7px">' + oddRow('Over 9.5 corners', mm.over95c, 'c9o' + m.h) + oddRow('Under 9.5 corners', mm.under95c, 'c9u' + m.h) + '</div>';
    } else {
      body = '<div style="display:flex;gap:12px;margin-bottom:12px">' + probBar(m.h, mm.pH, AC) + probBar('Draw', mm.pD, MUT) + probBar(m.a, mm.pA, POS) + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:7px">'
        + oddRow(H.name + ' to win', mm.pH, '1x2h' + m.h) + oddRow('Draw', mm.pD, '1x2d' + m.h) + oddRow(A.name + ' to win', mm.pA, '1x2a' + m.h)
        + oddRow('Over 2.5 goals', mm.over25, 'o25' + m.h) + oddRow('Under 2.5 goals', mm.under25, 'u25' + m.h) + oddRow('Both teams to score', mm.btts, 'btts' + m.h)
        + '</div>';
    }
    return '<div style="background:#13161e;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px">' + head + body + '</div>';
  }

  function renderMatches(corners) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">'
      + MATCHES.map(function (m) { return matchCard(m, { corners: corners }); }).join('') + '</div>';
  }

  function body() {
    if (state.tab === 'radar') return renderRadar();
    if (state.tab === 'matches') return renderMatches(false);
    if (state.tab === 'corners') return renderMatches(true);
    return '';
  }

  function switcher(active) {
    function b(id, label) { var on = active === id; return '<button data-act="sport" data-sport="' + id + '" style="padding:7px 14px;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:800;font-size:12.5px;background:' + (on ? (id === 'soccer' ? AC : '#ff8a4c') : 'transparent') + ';color:' + (on ? '#0a0c11' : MUT) + '">' + label + '</button>'; }
    return '<div style="display:inline-flex;gap:3px;padding:3px;border-radius:11px;background:#13161e;border:1px solid rgba(255,255,255,.09)">' + b('mlb', '\u26BE MLB') + b('soccer', '\u26BD Soccer') + '</div>';
  }

  function render() {
    if (!overlay) return;
    var tabs = tabBtn('radar', 'Goalscorer Radar') + tabBtn('matches', 'Matches') + tabBtn('corners', 'Corners Edge');
    overlay.innerHTML =
      '<style>@media(max-width:760px){.dlsc-wrap{padding:16px 14px 40px!important}.dlsc-head{flex-wrap:wrap!important;gap:10px!important}}</style>'
      + '<div style="position:sticky;top:0;z-index:5;background:rgba(10,12,17,.9);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.07)">'
      + '<div class="dlsc-head" style="display:flex;align-items:center;gap:16px;padding:14px 22px;max-width:1240px;margin:0 auto">'
      + '<div style="display:flex;align-items:center;gap:11px"><div style="width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:19px;background:linear-gradient(150deg,' + AC + ',#35d0c0);box-shadow:0 6px 20px rgba(46,230,166,.3)">\u26BD</div>'
      + '<div style="line-height:1"><div style="font-family:inherit;font-weight:800;font-size:19px;letter-spacing:-.02em">Dinger<span style="color:' + AC + '">Lab</span></div><div style="font-size:11px;color:' + MUT + ';letter-spacing:.04em;margin-top:2px">WORLD CUP 2026 \u00B7 SOCCER</div></div></div>'
      + '<div style="flex:1"></div>'
      + '<div style="display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:10px;background:rgba(46,230,166,.08);border:1px solid rgba(46,230,166,.22)"><span style="width:7px;height:7px;border-radius:50%;background:' + AC + '"></span><span style="font-size:12px;font-weight:700;color:' + AC + '">Model \u00B7 sample slate</span></div>'
      + switcher('soccer')
      + '</div></div>'
      + '<div class="dlsc-wrap" style="max-width:1240px;margin:0 auto;padding:22px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px">'
      + '<div><h1 style="margin:0;font-family:inherit;font-size:26px;font-weight:800;letter-spacing:-.02em">Soccer Intelligence</h1>'
      + '<div style="font-size:13px;color:' + MUT + ';margin-top:4px">Anytime goalscorer, match result, goals & corners \u2014 World Cup 2026 knockouts</div></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + tabs + '</div></div>'
      + body()
      + '<div style="margin-top:28px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06);font-size:11.5px;color:' + MUT + ';line-height:1.6">Model probabilities are computed from team strength & player threat (offline sample slate). Live odds wire through the OddsBlaze <code>league=' + esc(LEAGUE) + '</code> endpoint when the server is connected. For entertainment only.</div>'
      + '</div>';
  }

  function setSport(s) {
    try { localStorage.setItem('dl_sport', s); } catch (e) {}
    if (s === 'soccer') {
      if (!overlay) buildOverlay();
      overlay.style.display = 'block';
      document.body.style.overflow = 'hidden';
      render();
      overlay.scrollTop = 0;
    } else {
      if (overlay) overlay.style.display = 'none';
      document.body.style.overflow = '';
    }
    updateHeaderSwitcher(s);
  }

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'dl-soccer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow-y:auto;background:' + BG + ';color:' + TXT + ";font-family:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;display:none";
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'sport') setSport(el.getAttribute('data-sport'));
      else if (act === 'tab') { state.tab = el.getAttribute('data-tab'); render(); overlay.scrollTop = 0; }
      else if (act === 'team') { state.teamFilter = el.getAttribute('data-team'); render(); }
    });
  }

  // header switcher injected into the baseball app
  var headerSwitcher = null;
  function updateHeaderSwitcher(active) {
    if (headerSwitcher) headerSwitcher.innerHTML = switcher(active);
  }
  function injectHeaderSwitcher() {
    if (headerSwitcher) return;
    var header = document.querySelector('header[data-hdr]');
    if (!header) return false;
    headerSwitcher = document.createElement('div');
    headerSwitcher.id = 'dl-sport-switch';
    headerSwitcher.style.cssText = 'display:flex;align-items:center;margin-left:2px';
    headerSwitcher.innerHTML = switcher(currentSport());
    headerSwitcher.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act="sport"]'); if (!el) return;
      setSport(el.getAttribute('data-sport'));
    });
    // place right after the logo block (first child)
    if (header.children.length > 1) header.insertBefore(headerSwitcher, header.children[1]);
    else header.appendChild(headerSwitcher);
    return true;
  }

  function currentSport() { try { return localStorage.getItem('dl_sport') || 'mlb'; } catch (e) { return 'mlb'; } }

  function init() {
    // poll for the baseball header (it renders after React boots)
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (injectHeaderSwitcher() || tries > 60) clearInterval(iv);
    }, 250);
    // also provide a fallback floating switch in case the header never appears
    setTimeout(function () {
      if (!headerSwitcher && !document.getElementById('dl-sport-float')) {
        var f = document.createElement('div');
        f.id = 'dl-sport-float';
        f.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100001';
        f.innerHTML = switcher(currentSport());
        f.addEventListener('click', function (e) { var el = e.target.closest('[data-act="sport"]'); if (el) setSport(el.getAttribute('data-sport')); });
        document.body.appendChild(f);
        headerSwitcher = f;
      }
    }, 4000);
    if (currentSport() === 'soccer') setSport('soccer');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
