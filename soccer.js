/*
 * soccer.js - DingerLab Soccer (World Cup 2026) module.
 *
 * Self-contained, dependency-free (no React needed). Injects a top-level
 * MLB <-> Soccer switcher and a full-screen soccer view layered over the
 * existing baseball app, without touching the compiled dc template.
 *
 * Markets: Anytime Goalscorer (home-run analog), Match Result (1X2),
 * Over/Under 2.5 Goals, Both Teams To Score, and Corners.
 * The fixture slate is anchored to the current date, so there is always a
 * live "Today" slate with kickoff times and live/FT status.
 */
(function () {
  'use strict';
  if (window.__DL_SOCCER__) return;
  window.__DL_SOCCER__ = true;

  var AC = '#2ee6a6';      // soccer accent (green)
  var POS = '#35d0c0';
  var WARN = '#ffc24d';
  var NEG = '#ff6b6b';
  var BG = '#0a0c11';
  var TXT = '#eef1f6';
  var MUT = '#7b8597';
  var CARD = '#13161e';
  var INSET = '#0c0e14';
  var LEAGUE = (window.DL_SOCCER_LEAGUE || 'world_cup');
  var LIVE_MIN = 115; // minutes a match is considered in-play

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

  function market(modelProb, key) {
    var margin = (seed(key) - 0.42) * 0.22;
    var bookProb = clamp(modelProb * (1 + margin), 0.02, 0.96);
    var am = americanFromProb(bookProb);
    var edge = modelProb - bookProb;
    var ev = modelProb * profitPer100(am) - (1 - modelProb) * 100;
    var score = clamp(Math.round(38 + edge * 340 + modelProb * 46), 1, 99);
    return { am: am, bookProb: bookProb, edge: edge, ev: ev, score: score };
  }

  function fmtTime(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayLabel(d) {
    var now = new Date(); var tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, tm)) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function statusOf(d) {
    var now = Date.now(), k = d.getTime();
    if (now < k) {
      var mins = Math.round((k - now) / 60000);
      var rel = mins < 60 ? ('in ' + mins + 'm') : mins < 1440 ? ('in ' + Math.round(mins / 60) + 'h') : dayLabel(d);
      return { key: 'up', label: fmtTime(d), rel: rel, color: MUT, dot: MUT };
    }
    if (now < k + LIVE_MIN * 60000) {
      var elapsed = Math.round((now - k) / 60000);
      return { key: 'live', label: 'LIVE ' + (elapsed > 90 ? '90+' : elapsed) + "'", rel: 'in play', color: NEG, dot: NEG };
    }
    return { key: 'ft', label: 'FT', rel: 'full time', color: MUT, dot: '#3a4150' };
  }

  // ---------------------------------------------------------------- data
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

  var PAIRS = [['FRA', 'MAR'], ['ARG', 'CRO'], ['ESP', 'MEX'], ['BRA', 'URU'], ['ENG', 'JPN'], ['POR', 'USA'], ['GER', 'BEL'], ['NED', 'CAN']];
  var VENUES = ['AT&T Stadium, Dallas', 'MetLife Stadium, NJ', 'Estadio Azteca, Mexico City', 'SoFi Stadium, LA', 'Arrowhead, Kansas City', "Levi's Stadium, SF", 'Gillette Stadium, Boston', 'BMO Field, Toronto'];
  // Anchor the slate to the current date: 4 matches today, then spread out.
  var PLAN = [{ o: 0, h: 12 }, { o: 0, h: 15 }, { o: 0, h: 18 }, { o: 0, h: 21 }, { o: 1, h: 15 }, { o: 1, h: 18 }, { o: 2, h: 15 }, { o: 2, h: 18 }];
  function buildMatches() {
    var now = new Date();
    return PAIRS.map(function (p, i) {
      var pl = PLAN[i];
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + pl.o, pl.h, 0, 0, 0);
      return { h: p[0], a: p[1], date: d, stage: 'Round of 16', venue: VENUES[i] };
    });
  }
  var MATCHES = buildMatches();

  // ---------------------------------------------------------------- models
  function oppMap() { var o = {}; MATCHES.forEach(function (m) { o[m.h] = { opp: m.a, home: true, m: m }; o[m.a] = { opp: m.h, home: false, m: m }; }); return o; }
  function goalscorers() {
    var opp = oppMap(); var out = [];
    PLAYERS.forEach(function (p) {
      var fx = opp[p.t]; if (!fx) return;
      var team = TEAMS[p.t], op = TEAMS[fx.opp];
      var lam = p.threat * (team.atk / op.def) * p.min * (fx.home ? 1.06 : 0.97);
      var prob = clamp(1 - Math.exp(-lam), 0.03, 0.85);
      var mk = market(prob, 'gs' + p.n);
      out.push({
        name: p.n, team: p.t, teamName: team.name, flag: team.flag, pos: p.pos,
        opp: fx.opp, oppName: op.name, home: fx.home, date: fx.m.date, stage: fx.m.stage,
        prob: prob, am: mk.am, edge: mk.edge, ev: mk.ev, score: mk.score,
        init: p.n.split(' ').map(function (w) { return w[0]; }).slice(-2).join('')
      });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }
  function matchModel(m) {
    var H = TEAMS[m.h], A = TEAMS[m.a], BASE = 1.35;
    var xgH = BASE * (H.atk / A.def) * 1.08, xgA = BASE * (A.atk / H.def) * 0.95;
    var pH = 0, pD = 0, pA = 0, N = 8;
    for (var i = 0; i <= N; i++) for (var j = 0; j <= N; j++) { var pr = pois(i, xgH) * pois(j, xgA); if (i > j) pH += pr; else if (i === j) pD += pr; else pA += pr; }
    var tot = xgH + xgA, over25 = 1 - poisAtMost(2, tot);
    var btts = (1 - poisAtMost(0, xgH)) * (1 - poisAtMost(0, xgA));
    var cxTot = H.corners * (H.atk / A.def) + A.corners * (A.atk / H.def);
    var over95c = 1 - poisAtMost(9, cxTot);
    return { xgH: xgH, xgA: xgA, pH: pH, pD: pD, pA: pA, over25: over25, under25: 1 - over25, btts: btts, cxTot: cxTot, over95c: over95c, under95c: 1 - over95c };
  }
  function marketsForMatch(m) {
    var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a], lbl = H.name + ' v ' + A.name;
    var base = [
      { grp: 'Result', label: H.name + ' win', prob: mm.pH, key: '1x2h' + m.h },
      { grp: 'Result', label: 'Draw', prob: mm.pD, key: '1x2d' + m.h },
      { grp: 'Result', label: A.name + ' win', prob: mm.pA, key: '1x2a' + m.h },
      { grp: 'Goals', label: 'Over 2.5 goals', prob: mm.over25, key: 'o25' + m.h },
      { grp: 'Goals', label: 'Under 2.5 goals', prob: mm.under25, key: 'u25' + m.h },
      { grp: 'Goals', label: 'Both teams to score', prob: mm.btts, key: 'btts' + m.h },
      { grp: 'Corners', label: 'Over 9.5 corners', prob: mm.over95c, key: 'c9o' + m.h },
      { grp: 'Corners', label: 'Under 9.5 corners', prob: mm.under95c, key: 'c9u' + m.h }
    ];
    return base.map(function (s) { return Object.assign(s, market(s.prob, s.key), { match: lbl, date: m.date }); });
  }
  function bestValueToday() {
    var now = new Date(); var sels = [];
    MATCHES.filter(function (m) { return sameDay(m.date, now); }).forEach(function (m) { sels = sels.concat(marketsForMatch(m)); });
    goalscorers().filter(function (g) { return sameDay(g.date, now); }).forEach(function (g) {
      sels.push({ grp: 'Goalscorer', label: g.name + ' anytime', prob: g.prob, am: g.am, edge: g.edge, ev: g.ev, score: g.score, match: g.teamName + ' ' + (g.home ? 'v ' : '@ ') + g.oppName });
    });
    return sels.filter(function (s) { return s.edge > 0.02; }).sort(function (a, b) { return b.ev - a.ev; }).slice(0, 8);
  }

  // ---------------------------------------------------------------- UI atoms
  function scoreColor(s) { return s >= 70 ? AC : s >= 55 ? WARN : MUT; }
  function evColor(ev) { return ev > 5 ? POS : ev < -8 ? NEG : MUT; }
  function grpColor(g) { return g === 'Result' ? AC : g === 'Goals' ? POS : g === 'Corners' ? WARN : '#c88bff'; }
  function edgeBadge(e) {
    if (e >= 0.05) return '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(46,230,166,.16);color:' + AC + '">VALUE</span>';
    if (e <= -0.06) return '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(255,107,107,.14);color:' + NEG + '">FADE</span>';
    return '';
  }
  function statusPill(st) {
    return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:' + st.color + '">'
      + '<span class="' + (st.key === 'live' ? 'dlsc-live' : '') + '" style="width:7px;height:7px;border-radius:50%;background:' + st.dot + '"></span>' + esc(st.label) + '</span>';
  }
  function crest(code) {
    var t = TEAMS[code];
    return '<div style="width:40px;height:40px;flex:none;border-radius:50%;background:' + INSET + ';display:grid;place-items:center;font-size:20px;border:1px solid rgba(255,255,255,.08)">' + t.flag + '</div>';
  }
  function statCell(label, val, color) {
    return '<div style="flex:1;background:' + INSET + ';border:1px solid rgba(255,255,255,.06);border-radius:11px;padding:8px 10px"><div style="font-size:10px;color:' + MUT + ';font-weight:700">' + label + '</div><div style="font-family:inherit;font-weight:800;font-size:16px;color:' + color + '">' + val + '</div></div>';
  }
  function probBar(label, p, color) {
    return '<div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:11px;color:' + MUT + ';font-weight:700;margin-bottom:4px"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(label) + '</span><span style="color:' + color + '">' + Math.round(p * 100) + '%</span></div>'
      + '<div style="height:6px;border-radius:4px;background:' + INSET + ';overflow:hidden"><div style="height:100%;width:' + Math.round(p * 100) + '%;background:' + color + '"></div></div></div>';
  }
  function oddRow(label, prob, key) {
    var mk = market(prob, key);
    return '<div class="dlsc-row" style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:10px;background:' + INSET + ';border:1px solid rgba(255,255,255,.06)">'
      + '<div style="font-size:12.5px;font-weight:600">' + esc(label) + ' ' + edgeBadge(mk.edge) + '</div>'
      + '<div style="display:flex;gap:14px;align-items:center"><span style="font-size:12px;color:' + MUT + '">' + pct(prob) + '</span>'
      + '<span style="font-family:inherit;font-weight:800;font-size:15px;color:' + scoreColor(mk.score) + '">' + fmtAm(mk.am) + '</span>'
      + '<span style="font-size:11.5px;color:' + evColor(mk.ev) + ';font-weight:700;width:52px;text-align:right">' + (mk.ev > 0 ? '+' : '') + mk.ev.toFixed(1) + '</span></div></div>';
  }
  function tabBtn(id, label) {
    var on = state.tab === id;
    return '<button class="dlsc-btn" data-act="tab" data-tab="' + id + '" style="padding:8px 15px;border-radius:10px;font-weight:700;font-size:13px;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (on ? AC : 'transparent') + ';color:' + (on ? '#06231a' : MUT) + '">' + label + '</button>';
  }
  function switcher(active) {
    function b(id, label) { var on = active === id; return '<button class="dlsc-btn" data-act="sport" data-sport="' + id + '" style="padding:7px 14px;border:none;border-radius:8px;font-weight:800;font-size:12.5px;background:' + (on ? (id === 'soccer' ? AC : '#ff8a4c') : 'transparent') + ';color:' + (on ? '#0a0c11' : MUT) + '">' + label + '</button>'; }
    return '<div style="display:inline-flex;gap:3px;padding:3px;border-radius:11px;background:' + CARD + ';border:1px solid rgba(255,255,255,.09)">' + b('mlb', '\u26BE MLB') + b('soccer', '\u26BD Soccer') + '</div>';
  }

  // ---------------------------------------------------------------- cards
  function matchCardFull(m, opts) {
    var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a], st = statusOf(m.date);
    var fav = mm.pH >= mm.pA ? H.name : A.name, favP = Math.max(mm.pH, mm.pA);
    var head = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
      + '<div style="display:flex;align-items:center;gap:11px;min-width:0">' + crest(m.h)
      + '<div style="min-width:0"><div style="font-weight:800;font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(H.name) + ' <span style="color:' + MUT + '">v</span> ' + esc(A.name) + '</div>'
      + '<div style="font-size:11.5px;color:' + MUT + ';margin-top:3px">' + esc(m.stage) + ' \u00B7 ' + dayLabel(m.date) + ' ' + fmtTime(m.date) + ' \u00B7 ' + esc(m.venue) + '</div></div>'
      + crest(m.a) + '</div>'
      + '<div style="text-align:right;flex:none;padding-left:10px">' + statusPill(st) + '<div style="font-size:10px;color:' + MUT + ';font-weight:700;margin-top:4px">proj ' + Math.round(mm.xgH) + '-' + Math.round(mm.xgA) + '</div></div></div>';
    var body;
    if (opts.corners) {
      body = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="font-size:12px;color:' + MUT + '">Projected total corners</div><div style="font-family:inherit;font-weight:800;font-size:16px;color:' + WARN + '">' + mm.cxTot.toFixed(1) + '</div></div>'
        + '<div style="display:flex;flex-direction:column;gap:7px">' + oddRow('Over 9.5 corners', mm.over95c, 'c9o' + m.h) + oddRow('Under 9.5 corners', mm.under95c, 'c9u' + m.h) + '</div>';
    } else {
      body = '<div style="display:flex;gap:12px;margin-bottom:13px">' + probBar(H.name, mm.pH, AC) + probBar('Draw', mm.pD, MUT) + probBar(A.name, mm.pA, POS) + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:7px">'
        + oddRow(H.name + ' to win', mm.pH, '1x2h' + m.h) + oddRow('Draw', mm.pD, '1x2d' + m.h) + oddRow(A.name + ' to win', mm.pA, '1x2a' + m.h)
        + oddRow('Over 2.5 goals', mm.over25, 'o25' + m.h) + oddRow('Under 2.5 goals', mm.under25, 'u25' + m.h) + oddRow('Both teams to score', mm.btts, 'btts' + m.h) + '</div>';
    }
    return '<div class="dlsc-card" style="background:' + CARD + ';border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px">' + head + body + '</div>';
  }

  function miniMatch(m) {
    var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a], st = statusOf(m.date);
    var favHome = mm.pH >= mm.pA;
    var favName = favHome ? H.name : A.name, favP = Math.max(mm.pH, mm.pA);
    var favMk = market(favP, (favHome ? '1x2h' : '1x2a') + m.h);
    return '<button class="dlsc-card dlsc-btn" data-act="tab" data-tab="matches" style="text-align:left;width:100%;background:' + CARD + ';border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:13px 14px;display:flex;flex-direction:column;gap:9px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between">' + statusPill(st) + '<span style="font-size:11px;color:' + MUT + '">' + esc(m.stage) + '</span></div>'
      + '<div style="display:flex;align-items:center;gap:9px"><span style="font-size:20px">' + H.flag + '</span><span style="font-weight:800;font-size:15px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(H.name) + ' <span style="color:' + MUT + ';font-weight:600">v</span> ' + esc(A.name) + '</span><span style="font-size:20px">' + A.flag + '</span></div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">'
      + '<span style="font-size:11.5px;color:' + MUT + '">Model pick</span>'
      + '<span style="font-size:12.5px;font-weight:700">' + esc(favName) + ' <span style="color:' + AC + '">' + Math.round(favP * 100) + '%</span> \u00B7 ' + fmtAm(favMk.am) + '</span></div></div>';
  }

  function playerCard(p) {
    return '<div class="dlsc-card" style="background:' + CARD + ';border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:15px;display:flex;flex-direction:column;gap:12px">'
      + '<div style="display:flex;align-items:center;gap:12px"><div style="width:52px;height:52px;flex:none;border-radius:50%;background:' + INSET + ';display:grid;place-items:center;font-family:inherit;font-weight:800;font-size:16px;color:' + AC + '">' + esc(p.init) + '</div>'
      + '<div style="min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-weight:700;font-size:15px">' + esc(p.name) + '</span>' + edgeBadge(p.edge) + '</div>'
      + '<div style="font-size:12px;color:' + MUT + ';margin-top:2px">' + p.flag + ' ' + esc(p.teamName) + ' ' + (p.home ? 'vs' : '@') + ' ' + esc(p.oppName) + ' \u00B7 ' + esc(p.pos) + ' \u00B7 ' + dayLabel(p.date) + '</div></div>'
      + '<div style="margin-left:auto;text-align:center"><div style="font-size:10px;color:' + MUT + ';font-weight:700">SCORE</div><div style="font-family:inherit;font-weight:800;font-size:22px;color:' + scoreColor(p.score) + '">' + p.score + '</div></div></div>'
      + '<div style="display:flex;gap:8px">' + statCell('Goal \u00B7 model', pct(p.prob), TXT) + statCell('Anytime', fmtAm(p.am), scoreColor(p.score)) + statCell('EV /$100', (p.ev > 0 ? '+' : '') + p.ev.toFixed(1), evColor(p.ev)) + '</div></div>';
  }

  function valueRow(s) {
    return '<div class="dlsc-row" style="display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;background:' + INSET + ';border:1px solid rgba(255,255,255,.06)">'
      + '<span style="font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.05);color:' + grpColor(s.grp) + ';flex:none">' + s.grp.toUpperCase() + '</span>'
      + '<div style="min-width:0;flex:1"><div style="font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.label) + '</div><div style="font-size:11px;color:' + MUT + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.match) + '</div></div>'
      + '<div style="text-align:right;flex:none"><div style="font-family:inherit;font-weight:800;font-size:15px;color:' + scoreColor(s.score) + '">' + fmtAm(s.am) + '</div><div style="font-size:11px;color:' + POS + ';font-weight:700">EV +' + s.ev.toFixed(1) + '</div></div></div>';
  }

  // ---------------------------------------------------------------- tab bodies
  function sectionHead(bar, title, right) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;margin:26px 0 14px"><div style="display:flex;align-items:center;gap:9px"><span style="width:3px;height:18px;border-radius:2px;background:' + bar + '"></span><h2 style="margin:0;font-family:inherit;font-size:18px;font-weight:800">' + title + '</h2></div>' + (right || '') + '</div>';
  }

  function renderToday() {
    var now = new Date();
    var todays = MATCHES.filter(function (m) { return sameDay(m.date, now); }).sort(function (a, b) { return a.date - b.date; });
    var gsToday = goalscorers().filter(function (g) { return sameDay(g.date, now); }).slice(0, 6);
    var value = bestValueToday();
    var live = todays.filter(function (m) { return statusOf(m.date).key === 'live'; }).length;
    var dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    var hero = '<div style="background:linear-gradient(135deg,rgba(46,230,166,.12),rgba(53,208,192,.03));border:1px solid rgba(46,230,166,.2);border-radius:18px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">'
      + '<div><div style="font-size:12px;color:' + AC + ';font-weight:800;letter-spacing:.05em">TODAY \u00B7 ' + esc(dateStr.toUpperCase()) + '</div>'
      + '<div style="font-size:22px;font-weight:800;margin-top:4px">' + todays.length + ' match' + (todays.length === 1 ? '' : 'es') + (live ? ' \u00B7 <span style="color:' + NEG + '">' + live + ' live</span>' : '') + '</div></div>'
      + '<div style="display:flex;gap:22px"><div><div style="font-size:10px;color:' + MUT + ';font-weight:700">GOALSCORER PICKS</div><div style="font-family:inherit;font-weight:800;font-size:20px;color:' + AC + '">' + gsToday.length + '</div></div>'
      + '<div><div style="font-size:10px;color:' + MUT + ';font-weight:700">VALUE BETS</div><div style="font-family:inherit;font-weight:800;font-size:20px;color:' + POS + '">' + value.length + '</div></div></div></div>';

    var todayMatches = todays.length
      ? '<div class="dlsc-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + todays.map(miniMatch).join('') + '</div>'
      : '<div style="color:' + MUT + ';font-size:13px;padding:20px;text-align:center;background:' + CARD + ';border-radius:14px;border:1px solid rgba(255,255,255,.07)">No matches today \u2014 check the Matches tab for the upcoming slate.</div>';

    var valueBoard = value.length
      ? '<div style="display:flex;flex-direction:column;gap:8px">' + value.map(valueRow).join('') + '</div>'
      : '<div style="color:' + MUT + ';font-size:13px">No standout value on today\u2019s slate.</div>';

    var gsBoard = gsToday.length
      ? '<div class="dlsc-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + gsToday.map(playerCard).join('') + '</div>'
      : '<div style="color:' + MUT + ';font-size:13px">No goalscorer angles today.</div>';

    return hero
      + sectionHead(AC, "Today's Matches", '<button class="dlsc-btn" data-act="tab" data-tab="matches" style="background:none;border:1px solid rgba(255,255,255,.12);color:' + MUT + ';font-weight:600;font-size:12px;padding:6px 12px;border-radius:9px">All matches \u2192</button>') + todayMatches
      + sectionHead(POS, 'Best Value Today') + valueBoard
      + sectionHead(WARN, "Today's Top Goalscorers", '<button class="dlsc-btn" data-act="tab" data-tab="radar" style="background:none;border:1px solid rgba(255,255,255,.12);color:' + MUT + ';font-weight:600;font-size:12px;padding:6px 12px;border-radius:9px">Full radar \u2192</button>') + gsBoard;
  }

  function dateChips() {
    var days = [];
    MATCHES.slice().sort(function (a, b) { return a.date - b.date; }).forEach(function (m) { var k = dayKey(m.date); if (!days.some(function (d) { return d.k === k; })) days.push({ k: k, date: m.date }); });
    var chip = function (k, label, on) { return '<button class="dlsc-btn" data-act="date" data-date="' + k + '" style="padding:6px 13px;border-radius:20px;font-weight:700;font-size:12px;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (on ? AC : CARD) + ';color:' + (on ? '#06231a' : MUT) + '">' + label + '</button>'; };
    var out = chip('all', 'All days', state.dateFilter === 'all');
    out += days.map(function (d) { return chip(d.k, dayLabel(d.date) + ' ' + d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), state.dateFilter === d.k); }).join('');
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">' + out + '</div>';
  }

  function renderMatches(corners) {
    var list = MATCHES.slice().sort(function (a, b) { return a.date - b.date; });
    if (state.dateFilter !== 'all') list = list.filter(function (m) { return dayKey(m.date) === state.dateFilter; });
    var groups = [];
    list.forEach(function (m) { var k = dayKey(m.date); var g = groups.filter(function (x) { return x.k === k; })[0]; if (!g) { g = { k: k, date: m.date, items: [] }; groups.push(g); } g.items.push(m); });
    var html = dateChips();
    if (!groups.length) { html += '<div style="color:' + MUT + ';font-size:13px">No matches for that day.</div>'; return html; }
    groups.forEach(function (g) {
      html += '<div style="display:flex;align-items:center;gap:10px;margin:18px 0 12px"><span style="font-family:inherit;font-weight:800;font-size:14px">' + dayLabel(g.date) + '</span><span style="font-size:12px;color:' + MUT + '">' + g.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '</span><span style="flex:1;height:1px;background:rgba(255,255,255,.07)"></span></div>';
      html += '<div class="dlsc-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">' + g.items.map(function (m) { return matchCardFull(m, { corners: corners }); }).join('') + '</div>';
    });
    return html;
  }

  function renderRadar() {
    var all = goalscorers();
    var teams = Object.keys(TEAMS).filter(function (t) { return all.some(function (p) { return p.team === t; }); }).sort();
    var chip = function (t, label, on) { return '<button class="dlsc-btn" data-act="team" data-team="' + t + '" style="padding:6px 12px;border-radius:20px;font-weight:700;font-size:12px;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (on ? AC : CARD) + ';color:' + (on ? '#06231a' : MUT) + '">' + label + '</button>'; };
    var chips = chip('', 'All teams', state.teamFilter === '') + teams.map(function (t) { return chip(t, TEAMS[t].flag + ' ' + t, state.teamFilter === t); }).join('');
    var list = state.teamFilter ? all.filter(function (p) { return p.team === state.teamFilter; }) : all;
    var top = list.filter(function (p) { return p.score >= 68; }).slice(0, 4);
    var strip = top.length ? '<div style="background:linear-gradient(150deg,rgba(46,230,166,.10),rgba(53,208,192,.04));border:1px solid rgba(46,230,166,.22);border-radius:16px;padding:14px 16px">'
      + '<div style="font-family:inherit;font-weight:800;font-size:13px;color:' + AC + ';margin-bottom:10px">\u2605 TOP VALUE PICKS</div>'
      + '<div class="dlsc-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">'
      + top.map(function (p) { return '<div style="background:' + INSET + ';border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 12px"><div style="font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</div><div style="font-size:11.5px;color:' + MUT + ';margin:3px 0">Anytime ' + fmtAm(p.am) + ' \u00B7 ' + pct(p.prob) + '</div><div style="font-family:inherit;font-weight:800;font-size:18px;color:' + AC + '">' + p.score + '</div></div>'; }).join('') + '</div></div>' : '';
    return '<div style="margin-bottom:16px">' + strip + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 6px">' + chips + '</div></div>'
      + '<div class="dlsc-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + list.map(playerCard).join('') + '</div>';
  }

  function body() {
    if (state.tab === 'today') return renderToday();
    if (state.tab === 'radar') return renderRadar();
    if (state.tab === 'matches') return renderMatches(false);
    if (state.tab === 'corners') return renderMatches(true);
    return '';
  }

  // ---------------------------------------------------------------- shell
  var state = { tab: 'today', teamFilter: '', dateFilter: 'all' };
  var overlay = null, headerSwitcher = null, tickTimer = null;

  function render() {
    if (!overlay) return;
    var tabs = tabBtn('today', '\u26A1 Today') + tabBtn('radar', 'Goalscorer Radar') + tabBtn('matches', 'Matches') + tabBtn('corners', 'Corners');
    overlay.innerHTML =
      '<style>#dl-soccer-overlay *{box-sizing:border-box}'
      + '.dlsc-card{transition:transform .15s,border-color .15s}.dlsc-card:hover{border-color:rgba(46,230,166,.5);transform:translateY(-2px)}'
      + '.dlsc-btn{cursor:pointer;font-family:inherit;transition:filter .12s,background .12s,color .12s}.dlsc-btn:hover{filter:brightness(1.14)}'
      + '.dlsc-row{transition:border-color .12s}.dlsc-row:hover{border-color:rgba(46,230,166,.32)}'
      + '@keyframes dlscpulse{0%,100%{opacity:1}50%{opacity:.3}}.dlsc-live{animation:dlscpulse 1.4s infinite}'
      + '@media(max-width:760px){.dlsc-wrap{padding:16px 14px 44px!important}.dlsc-head{gap:10px!important}.dlsc-grid{grid-template-columns:1fr!important}}</style>'
      + '<div style="position:sticky;top:0;z-index:5;background:rgba(10,12,17,.92);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.07)">'
      + '<div class="dlsc-head" style="display:flex;align-items:center;gap:16px;padding:13px 22px;max-width:1240px;margin:0 auto;flex-wrap:wrap">'
      + '<div style="display:flex;align-items:center;gap:11px"><div style="width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:19px;background:linear-gradient(150deg,' + AC + ',#35d0c0);box-shadow:0 6px 20px rgba(46,230,166,.3)">\u26BD</div>'
      + '<div style="line-height:1"><div style="font-family:inherit;font-weight:800;font-size:19px;letter-spacing:-.02em">Dinger<span style="color:' + AC + '">Lab</span></div><div style="font-size:11px;color:' + MUT + ';letter-spacing:.04em;margin-top:2px">WORLD CUP 2026 \u00B7 SOCCER</div></div></div>'
      + '<div style="flex:1"></div>'
      + '<div style="display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:10px;background:rgba(46,230,166,.08);border:1px solid rgba(46,230,166,.22)"><span style="width:7px;height:7px;border-radius:50%;background:' + AC + '"></span><span style="font-size:12px;font-weight:700;color:' + AC + '">Model \u00B7 sample slate</span></div>'
      + switcher('soccer') + '</div>'
      + '<div style="max-width:1240px;margin:0 auto;padding:0 22px 12px;display:flex;gap:8px;flex-wrap:wrap">' + tabs + '</div></div>'
      + '<div class="dlsc-wrap" style="max-width:1240px;margin:0 auto;padding:22px">'
      + body()
      + '<div style="margin-top:30px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06);font-size:11.5px;color:' + MUT + ';line-height:1.6">Model probabilities are computed from team strength & player threat on an offline sample slate anchored to today. Live odds wire through the OddsBlaze <code>league=' + esc(LEAGUE) + '</code> endpoint when the server is connected. For entertainment only.</div></div>';
  }

  function setSport(s) {
    try { localStorage.setItem('dl_sport', s); } catch (e) {}
    if (s === 'soccer') {
      if (!overlay) buildOverlay();
      overlay.style.display = 'block';
      document.body.style.overflow = 'hidden';
      render(); overlay.scrollTop = 0;
      if (!tickTimer) tickTimer = setInterval(function () { if (overlay && overlay.style.display !== 'none') render(); }, 60000);
    } else {
      if (overlay) overlay.style.display = 'none';
      document.body.style.overflow = '';
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
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
      else if (act === 'date') { state.dateFilter = el.getAttribute('data-date'); render(); }
    });
  }

  function updateHeaderSwitcher(active) { if (headerSwitcher) headerSwitcher.innerHTML = switcher(active); }
  function injectHeaderSwitcher() {
    if (headerSwitcher) return true;
    var header = document.querySelector('header[data-hdr]');
    if (!header) return false;
    headerSwitcher = document.createElement('div');
    headerSwitcher.id = 'dl-sport-switch';
    headerSwitcher.style.cssText = 'display:flex;align-items:center;margin-left:2px';
    headerSwitcher.innerHTML = switcher(currentSport());
    headerSwitcher.addEventListener('click', function (e) { var el = e.target.closest('[data-act="sport"]'); if (el) setSport(el.getAttribute('data-sport')); });
    if (header.children.length > 1) header.insertBefore(headerSwitcher, header.children[1]); else header.appendChild(headerSwitcher);
    return true;
  }
  function currentSport() { try { return localStorage.getItem('dl_sport') || 'mlb'; } catch (e) { return 'mlb'; } }

  function init() {
    var tries = 0;
    var iv = setInterval(function () { tries++; if (injectHeaderSwitcher() || tries > 60) clearInterval(iv); }, 250);
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
