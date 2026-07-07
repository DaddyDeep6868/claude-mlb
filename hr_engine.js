/*
 * hr_engine.js - DingerLab MLB Home Run Prediction Engine (client-side).
 *
 * Self-contained, dependency-free. Adds an MLB-side "HR Engine" launcher + a
 * full-screen overlay that mirrors the MLB app's design language. Runs a real
 * calibrated logistic model + Monte Carlo plate-appearance simulation entirely
 * in the browser from an embedded model + digital player profiles (window.HR_DATA,
 * produced by the Python training pipeline). Currently trained on SYNTHETIC data
 * until live Statcast is connected; the badge makes that explicit.
 */
(function () {
  'use strict';
  if (window.__DL_HRENGINE__) return;
  window.__DL_HRENGINE__ = true;

  // ---- MLB design tokens (mirrored from soccer.js / the MLB app) ----
  var AC = '#ff8a4c', PINK = '#ff4d7d', POS = '#35d0c0', GOLD = '#ffc24d', NEG = '#ff6b6b';
  var BG = '#0a0c11', CARD = '#13161e', INSET = '#0c0e14', INSET2 = '#0f1218';
  var TXT = '#eef1f6', MUT = '#7b8597', MUT2 = '#8b94a6', MUT3 = '#9aa3b2';
  var LINE = 'rgba(255,255,255,.07)';
  var FH = "'Space Grotesk',ui-sans-serif,system-ui,sans-serif";
  var FB = "'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif";
  var PTYPES = ['FF', 'SI', 'SL', 'CH', 'CU', 'FC'];
  var LG_EV = 88.0, LG_BARREL = 0.13, PA_GAME = 4.1;

  var D = window.HR_DATA || null;
  var FEATS = D ? D.model.feats : [];
  var IDX = {}; FEATS.forEach(function (f, i) { IDX[f] = i; });

  // ---------------------------------------------------------------- math
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sigmoid(z) { return 1 / (1 + Math.exp(-clamp(z, -35, 35))); }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function normal(rng) { var u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function weatherMult(t, w, air) { return clamp(1 + 0.006 * (t - 70) + 0.010 * (w - 7) * 0.5 + (1 - air) * 3.0, 0.82, 1.25); }

  // ---------------------------------------------------------------- model
  function featObj(h, p, pf, wx, bside, phand, fat) {
    var plat = (bside === 'S' || bside !== phand) ? 1 : 0, pc = 0;
    for (var i = 0; i < PTYPES.length; i++) { var t = PTYPES[i]; pc += (p.arsenal[t] || 0) * (((h.barrel_vs || {})[t] || LG_BARREL) - LG_BARREL); }
    return {
      h_pa: Math.log1p(h.pa), h_hr_rate: h.hr_rate, h_barrel_rate: h.barrel_rate, h_hardhit: h.hardhit,
      h_ev: h.ev - LG_EV, h_la: h.la, h_fb: h.fb, h_bip: h.bip_rate,
      p_pa: Math.log1p(p.pa), p_hr_rate: p.hr_rate, p_barrel_rate: p.barrel_rate, p_hardhit: p.hardhit,
      p_ev: p.ev - LG_EV, p_velo: p.velo - 93, p_meatball: p.meatball,
      park_hr: pf, weather: wx, platoon_fav: plat,
      power_momentum: h.recent_barrel - h.barrel_rate, pitch_compat: pc,
      mistake_punish: h.meatball_barrel * p.meatball * 10, hr_env: pf * wx - 1,
      contact_trend: h.recent_ev - h.ev, fatigue: fat || 0
    };
  }
  function vecOf(o) { return FEATS.map(function (f) { return o[f]; }); }
  function scoreLR(vec) { var m = D.model, z = m.b; for (var i = 0; i < vec.length; i++) z += m.w[i] * ((vec[i] - m.mu[i]) / m.sd[i]); return sigmoid(z); }
  function calibrate(p) { var c = D.model.cal, n = c.length - 1, x = clamp(p, 0, 1) * n, i = Math.floor(x), f = x - i; if (i >= n) return c[n]; return c[i] * (1 - f) + c[i + 1] * f; }
  function predict(vec) { return calibrate(scoreLR(vec)); }

  var RPOS = { h_barrel_rate: 'Elite barrel rate', h_ev: 'High exit velocity', h_hardhit: 'Strong hard-hit rate', h_hr_rate: 'Proven power bat', power_momentum: 'Hot recent power form', contact_trend: 'Rising contact quality', pitch_compat: "Feasts on pitcher's arsenal", mistake_punish: 'Punishes mistake pitches', p_hr_rate: 'Pitcher allows HRs', p_barrel_rate: 'Pitcher yields barrels', p_meatball: 'Pitcher leaves meatballs', park_hr: 'Hitter-friendly park', hr_env: 'Favorable park + weather', weather: 'Weather aids carry', platoon_fav: 'Platoon advantage', h_fb: 'Fly-ball hitter' };
  var RNEG = { h_barrel_rate: 'Low barrel rate', h_ev: 'Below-avg exit velocity', power_momentum: 'Cold recent stretch', pitch_compat: "Struggles vs pitcher's mix", p_hr_rate: 'Pitcher suppresses HRs', p_meatball: 'Pitcher rarely misses spots', park_hr: 'Pitcher-friendly park', hr_env: 'Suppressive park/weather', platoon_fav: 'Platoon disadvantage', p_velo: 'High-velocity arm', h_ev: 'Below-avg exit velocity' };
  function contribs(vec) { var m = D.model, out = []; for (var i = 0; i < vec.length; i++) out.push([FEATS[i], m.w[i] * ((vec[i] - m.mu[i]) / m.sd[i])]); out.sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); }); return out; }
  function reasons(vec, k, positive) {
    var c = contribs(vec), out = [];
    for (var i = 0; i < c.length; i++) {
      var pos = c[i][1] > 0; if (positive != null && pos !== positive) continue;
      var ph = (pos ? RPOS : RNEG)[c[i][0]];
      if (ph && out.indexOf(ph) < 0) out.push(ph);
      if (out.length >= (k || 4)) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- simulation
  function simulate(h, p, pf, wx, bside, phand, n, seed) {
    n = n || 10000; var rng = mulberry32(seed || 1);
    var base = featObj(h, p, pf, wx, bside, phand), bvec = vecOf(base);
    var ts = PTYPES.filter(function (t) { return (p.arsenal[t] || 0) > 0; });
    var cum = [], s = 0; ts.forEach(function (t) { s += p.arsenal[t]; cum.push(s); });
    var hr = 0, evsum = 0, lasum = 0, brl = 0, pSum = 0;
    for (var i = 0; i < n; i++) {
      var r = rng() * s, ti = 0; while (ti < cum.length - 1 && r > cum[ti]) ti++;
      var t = ts[ti] || 'FF';
      var o = featObj(h, p, pf, wx, bside, phand);
      o.pitch_compat = (((h.barrel_vs || {})[t]) || LG_BARREL) - LG_BARREL;
      var meat = rng() < p.meatball;
      if (meat) { o.mistake_punish = h.meatball_barrel * 10; o.h_ev += 3; }
      var pm = predict(vecOf(o)); pSum += pm;
      if (rng() < pm) hr++;
      var ev = clamp(h.ev + (meat ? 3 : 0) + normal(rng) * 8.5, 45, 122);
      var la = clamp(h.la + normal(rng) * 12, -35, 55);
      evsum += ev; lasum += la;
      if (ev >= 98 && la >= 26 - (ev - 98) && la <= 30 + (ev - 98)) brl++;
    }
    var pPA = hr / n, pmMean = pSum / n, pGame = 1 - Math.pow(1 - pmMean, PA_GAME);
    var data = Math.min(h.pa, p.pa);
    var sc = (pGame > 0.16 ? 2 : pGame > 0.09 ? 1 : 0) + (data > 250 ? 1 : 0) + 1;
    var conf = sc >= 3 ? 'High' : sc >= 2 ? 'Medium' : 'Low';
    return {
      simPA: n, hr: hr, pPA: pPA, pGame: pGame, conf: conf,
      ev: evsum / n, la: lasum / n, barrel: brl / n,
      likes: reasons(bvec, 3, true), dislikes: reasons(bvec, 2, false), all: reasons(bvec, 4)
    };
  }
  // fast game-prob without full MC (for board build)
  function quickGame(h, p, pf, wx, bside, phand) {
    var pm = predict(vecOf(featObj(h, p, pf, wx, bside, phand)));
    return 1 - Math.pow(1 - pm, PA_GAME);
  }

  // ---------------------------------------------------------------- build slate
  var BOARD = [];
  function buildBoard() {
    if (!D) return; var rng = mulberry32(20260707); var rows = [];
    var H = D.hitters, P = D.pitchers, K = D.parks;
    var used = {};
    for (var g = 0; g < 60; g++) {
      var h = H[Math.floor(rng() * H.length)], p = P[Math.floor(rng() * P.length)];
      var park = K[Math.floor(rng() * K.length)];
      var key = h.id + '-' + p.id; if (used[key]) continue; used[key] = 1;
      var w = { t: 62 + rng() * 28, wind: Math.abs(normal(rng) * 4 + 8), air: 0.88 + rng() * 0.11 };
      var pf = h.bats === 'L' ? park.hr_l : park.hr_r, wx = weatherMult(w.t, w.wind, w.air);
      var pGame = quickGame(h, p, pf, wx, h.bats, p.throws);
      rows.push({ h: h, p: p, park: park, w: w, pf: pf, wx: wx, pGame: pGame });
    }
    rows.sort(function (a, b) { return b.pGame - a.pGame; });
    BOARD = rows.slice(0, 30);
  }

  // ---------------------------------------------------------------- UI helpers
  var state = { open: false, tab: 'board', min: 0, q: '', sel: null, sim: null };
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function confColor(c) { return c === 'High' ? POS : c === 'Medium' ? GOLD : MUT; }
  function chip(txt, col) { return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;font-family:' + FB + ';background:' + (col || 'rgba(255,255,255,.06)') + ';color:' + (col ? '#0a0c11' : MUT2) + ';margin:2px 4px 2px 0">' + txt + '</span>'; }
  function bar(v, col) { var w = clamp(v / 0.30, 0, 1) * 100; return '<div style="height:7px;border-radius:6px;background:rgba(255,255,255,.07);overflow:hidden;min-width:70px"><div style="height:100%;width:' + w.toFixed(0) + '%;background:' + col + '"></div></div>'; }
  function statCard(label, val, col) { return '<div style="background:' + INSET + ';border:1px solid ' + LINE + ';border-radius:14px;padding:14px 16px"><div style="font-family:' + FB + ';font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:' + MUT + '">' + label + '</div><div style="font-family:' + FH + ';font-size:24px;font-weight:700;color:' + (col || TXT) + ';margin-top:4px">' + val + '</div></div>'; }

  function boardRows() {
    var q = state.q.toLowerCase();
    return BOARD.filter(function (r) {
      if (r.pGame < state.min) return false;
      if (q && (r.h.name + ' ' + r.p.name).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderBoard() {
    var m = D.metrics;
    var cards = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 20px">'
      + statCard('Model AUC', m.auc.toFixed(3), POS) + statCard('Game AUC', m.game_auc.toFixed(3), POS)
      + statCard('Backtest ROI', (m.roi * 100 >= 0 ? '+' : '') + (m.roi * 100).toFixed(1) + '%', m.roi >= 0 ? POS : NEG)
      + statCard('PAs Learned', (m.pa / 1000).toFixed(0) + 'k', TXT) + '</div>';
    var filt = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">'
      + '<input data-act="q" placeholder="Search hitter or pitcher\u2026" value="' + state.q.replace(/"/g, '&quot;') + '" style="flex:1;min-width:200px;padding:9px 13px;border-radius:10px;border:1px solid ' + LINE + ';background:' + INSET + ';color:' + TXT + ';font-family:' + FB + ';font-size:13px">'
      + [['All', 0], ['10%+', 0.10], ['15%+', 0.15]].map(function (o) { var on = state.min === o[1]; return '<button data-act="min" data-v="' + o[1] + '" style="padding:8px 14px;border-radius:10px;border:1px solid ' + (on ? AC : LINE) + ';background:' + (on ? 'rgba(255,138,76,.15)' : INSET) + ';color:' + (on ? AC : MUT2) + ';font-family:' + FB + ';font-weight:700;font-size:12px;cursor:pointer">' + o[0] + '</button>'; }).join('') + '</div>';
    var rows = boardRows();
    var head = '<div style="display:grid;grid-template-columns:34px 1.4fr 1.3fr 90px 120px 74px;gap:10px;padding:0 12px 8px;font-family:' + FB + ';font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + MUT + '"><div>#</div><div>Hitter</div><div>Pitcher</div><div>Park</div><div>Game HR%</div><div>Conf</div></div>';
    var body = rows.map(function (r, i) {
      var col = r.pGame > 0.16 ? POS : r.pGame > 0.10 ? GOLD : MUT2;
      return '<div data-act="open" data-i="' + BOARD.indexOf(r) + '" style="display:grid;grid-template-columns:34px 1.4fr 1.3fr 90px 120px 74px;gap:10px;align-items:center;padding:12px;border-radius:12px;background:' + CARD + ';border:1px solid ' + LINE + ';margin-bottom:8px;cursor:pointer">'
        + '<div style="font-family:' + FH + ';font-weight:700;color:' + MUT + '">' + (i + 1) + '</div>'
        + '<div><div style="font-family:' + FH + ';font-weight:700">' + r.h.name + '</div><div style="font-size:11px;color:' + MUT + '">' + r.h.bats + 'HB \u00b7 ' + pct(r.h.barrel_rate) + ' barrel</div></div>'
        + '<div><div style="font-weight:600">' + r.p.name + '</div><div style="font-size:11px;color:' + MUT + '">' + r.p.throws + 'HP \u00b7 ' + r.p.velo.toFixed(0) + ' mph</div></div>'
        + '<div style="font-size:12px;color:' + MUT2 + '">' + r.park.name.replace(' Park', '') + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px"><span style="font-family:' + FH + ';font-weight:700;color:' + col + '">' + pct(r.pGame) + '</span>' + bar(r.pGame, col) + '</div>'
        + '<div>' + chip(r.pGame > 0.16 ? 'High' : r.pGame > 0.10 ? 'Med' : 'Low', confColor(r.pGame > 0.16 ? 'High' : r.pGame > 0.10 ? 'Medium' : 'Low')) + '</div></div>';
    }).join('');
    return '<div style="font-family:' + FB + ';font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:' + AC + '">Daily Slate \u00b7 Simulated</div>'
      + '<h1 style="font-family:' + FH + ';font-size:30px;font-weight:800;margin:4px 0 2px">Home Run Predictions</h1>'
      + '<div style="color:' + MUT + ';font-size:13px">Every matchup scored by a calibrated ML model + Monte Carlo simulation. Click a matchup for the full breakdown.</div>'
      + cards + filt + head + (body || '<div style="color:' + MUT + ';padding:30px;text-align:center">No matchups match your filter.</div>');
  }

  function ring(p, col) {
    var deg = clamp(p / 0.30, 0, 1) * 360;
    return '<div style="width:132px;height:132px;border-radius:50%;background:conic-gradient(' + col + ' ' + deg + 'deg,rgba(255,255,255,.07) 0);display:flex;align-items:center;justify-content:center">'
      + '<div style="width:104px;height:104px;border-radius:50%;background:' + INSET + ';display:flex;flex-direction:column;align-items:center;justify-content:center">'
      + '<div style="font-family:' + FH + ';font-size:28px;font-weight:800;color:' + col + '">' + pct(p) + '</div>'
      + '<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:' + MUT + '">Game HR%</div></div></div>';
  }
  function mini(label, val) { return '<div style="background:' + INSET + ';border:1px solid ' + LINE + ';border-radius:12px;padding:11px 13px"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:' + MUT + '">' + label + '</div><div style="font-family:' + FH + ';font-size:19px;font-weight:700;margin-top:3px">' + val + '</div></div>'; }
  function cmpRow(label, a, b, hi) {
    return '<div style="display:grid;grid-template-columns:1fr 120px 1fr;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid ' + LINE + '">'
      + '<div style="text-align:right;font-family:' + FH + ';font-weight:700;color:' + (hi === 'a' ? POS : TXT) + '">' + a + '</div>'
      + '<div style="text-align:center;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:' + MUT + '">' + label + '</div>'
      + '<div style="font-family:' + FH + ';font-weight:700;color:' + (hi === 'b' ? NEG : TXT) + '">' + b + '</div></div>';
  }
  function renderDetail() {
    var r = state.sel, s = state.sim; if (!r) return '';
    var col = s.pGame > 0.16 ? POS : s.pGame > 0.10 ? GOLD : MUT2;
    var h = r.h, p = r.p;
    var likes = s.likes.map(function (t) { return '<li style="margin:4px 0;color:' + POS + '">\u25B2 ' + t + '</li>'; }).join('');
    var dis = s.dislikes.map(function (t) { return '<li style="margin:4px 0;color:' + NEG + '">\u25BC ' + t + '</li>'; }).join('') || '<li style="color:' + MUT + '">No notable negatives</li>';
    return '<button data-act="back" style="background:none;border:1px solid ' + LINE + ';color:' + MUT2 + ';border-radius:10px;padding:7px 14px;font-family:' + FB + ';font-weight:700;cursor:pointer;margin-bottom:16px">\u2190 Back to board</button>'
      + '<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap;background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:18px;padding:20px">'
      + ring(s.pGame, col)
      + '<div style="flex:1;min-width:240px"><div style="font-family:' + FB + ';font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:' + AC + '">Matchup</div>'
      + '<h1 style="font-family:' + FH + ';font-size:26px;font-weight:800;margin:2px 0">' + h.name + '</h1>'
      + '<div style="color:' + MUT2 + ';font-size:14px">vs ' + p.name + ' \u00b7 ' + r.park.name + '</div>'
      + '<div style="margin-top:8px">' + chip(s.conf + ' confidence', confColor(s.conf)) + chip(r.h.bats + 'HB vs ' + r.p.throws + 'HP') + chip('Park ' + r.pf.toFixed(2)) + chip('Wx ' + r.wx.toFixed(2)) + '</div></div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0">'
      + mini('Simulated PAs', s.simPA.toLocaleString()) + mini('Home Runs', s.hr.toLocaleString())
      + mini('Per-PA HR%', pct(s.pPA)) + mini('Avg Exit Velo', s.ev.toFixed(1) + ' mph')
      + mini('Avg Launch \u00b0', s.la.toFixed(1) + '\u00b0') + mini('Sim Barrel%', pct(s.barrel))
      + mini('Park Factor', r.pf.toFixed(2)) + mini('Weather', r.wx.toFixed(2)) + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
      + '<div style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:16px;padding:16px"><div style="font-family:' + FB + ';font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + MUT + ';margin-bottom:8px">Why the model likes / dislikes</div>'
      + '<ul style="list-style:none;padding:0;margin:0;font-size:13px;font-family:' + FB + '">' + likes + dis + '</ul></div>'
      + '<div style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:16px;padding:16px"><div style="font-family:' + FB + ';font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + MUT + ';margin-bottom:8px">Matchup breakdown</div>'
      + '<div style="display:grid;grid-template-columns:1fr 120px 1fr;gap:8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:' + MUT + ';padding-bottom:4px"><div style="text-align:right">' + h.name.split(' ')[0] + '</div><div style="text-align:center"></div><div>' + p.name.split(' ')[0] + '</div></div>'
      + cmpRow('Barrel%', pct(h.barrel_rate), pct(p.barrel_rate), h.barrel_rate > p.barrel_rate ? 'a' : '')
      + cmpRow('Exit Velo', h.ev.toFixed(1), p.ev.toFixed(1), h.ev > p.ev ? 'a' : '')
      + cmpRow('HR rate', pct(h.hr_rate), pct(p.hr_rate), '')
      + cmpRow('Hard-hit%', pct(h.hardhit), pct(p.hardhit), '')
      + cmpRow('Recent form', pct(h.recent_barrel), p.velo.toFixed(0) + ' mph', h.recent_barrel > h.barrel_rate ? 'a' : '')
      + '</div></div>';
  }
  function renderModel() {
    var m = D.metrics;
    var eng = [['Power Momentum', 'Recent barrel rate vs season baseline'], ['Pitch Compatibility', "Hitter barrel rate weighted by pitcher's arsenal usage"], ['Mistake Punishment', 'Barrel rate on meatballs \u00d7 pitcher meatball rate'], ['HR Environment', 'Park HR factor \u00d7 weather carry multiplier'], ['Contact Quality Trend', 'Recent exit velocity vs season baseline'], ['Fatigue Impact', 'Pitcher workload in trailing days']];
    return '<div style="font-family:' + FB + ';font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:' + AC + '">Model Card</div>'
      + '<h1 style="font-family:' + FH + ';font-size:28px;font-weight:800;margin:4px 0 14px">How the engine predicts</h1>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">'
      + statCard('Test AUC', m.auc.toFixed(3), POS) + statCard('Log-loss', m.logloss.toFixed(3), POS)
      + statCard('Baseline LL', m.baseline_logloss.toFixed(3), MUT2) + statCard('Brier', m.brier.toFixed(3), TXT) + '</div>'
      + '<div style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:16px;padding:18px;margin-bottom:14px">'
      + '<div style="font-weight:700;font-family:' + FH + ';margin-bottom:8px">Pipeline</div>'
      + '<div style="color:' + MUT2 + ';font-size:13px;line-height:1.7">Pitch-level data \u2192 leakage-safe as-of features + digital player profiles \u2192 calibrated ensemble (logistic + gradient-boosted trees) \u2192 Monte Carlo plate-appearance simulation \u2192 backtested vs held-out games. Predictions here run the calibrated model live in your browser.</div></div>'
      + '<div style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:16px;padding:18px">'
      + '<div style="font-weight:700;font-family:' + FH + ';margin-bottom:10px">Engineered metrics</div>'
      + eng.map(function (e) { return '<div style="padding:8px 0;border-bottom:1px solid ' + LINE + '"><span style="font-family:' + FH + ';font-weight:700;color:' + AC + '">' + e[0] + '</span> <span style="color:' + MUT2 + ';font-size:13px">\u2014 ' + e[1] + '</span></div>'; }).join('') + '</div>';
  }

  // ---------------------------------------------------------------- shell
  var overlay = null;
  function ver() { return window.__DL_VERSION__ || ''; }
  function render() {
    if (!overlay) return;
    if (!D) { overlay.innerHTML = '<div style="padding:60px;text-align:center;color:' + MUT + '">HR Engine data not loaded.</div>'; return; }
    var main = state.sel ? renderDetail() : state.tab === 'model' ? renderModel() : renderBoard();
    var nav = [['board', 'Board', '\u26BE'], ['model', 'Model Card', '\uD83E\uDDE0']].map(function (n) {
      var on = state.tab === n[0] && !state.sel;
      return '<button data-act="tab" data-t="' + n[0] + '" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 14px;border-radius:12px;border:none;cursor:pointer;font-family:' + FB + ';font-weight:700;font-size:14px;margin-bottom:4px;background:' + (on ? 'rgba(255,138,76,.14)' : 'transparent') + ';color:' + (on ? AC : MUT2) + '">' + n[2] + ' ' + n[1] + '</button>';
    }).join('');
    overlay.innerHTML =
      '<div style="min-height:100%;background:radial-gradient(1200px 600px at 70% -10%,rgba(255,138,76,.10),transparent),radial-gradient(900px 500px at 10% 10%,rgba(255,77,125,.08),transparent),' + BG + '">'
      + '<header style="position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:14px;padding:14px 22px;background:rgba(10,12,17,.82);backdrop-filter:blur(14px);border-bottom:1px solid ' + LINE + '">'
      + '<div style="font-family:' + FH + ';font-weight:800;font-size:18px">Dinger<span style="color:' + AC + '">Lab</span></div>'
      + '<div style="font-family:' + FB + ';font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + MUT + '">HR Engine</div>'
      + (ver() ? '<span style="font-size:11px;color:' + MUT + ';border:1px solid ' + LINE + ';border-radius:20px;padding:2px 9px">' + ver() + '</span>' : '')
      + '<span style="font-size:10px;font-weight:800;letter-spacing:.06em;color:#0a0c11;background:' + GOLD + ';border-radius:20px;padding:3px 9px">SYNTHETIC DATA</span>'
      + '<div style="flex:1"></div>'
      + '<button data-act="close" style="background:none;border:1px solid ' + LINE + ';color:' + MUT2 + ';border-radius:10px;width:34px;height:34px;font-size:16px;cursor:pointer">\u2715</button></header>'
      + '<div id="dl-hr-shell" style="display:grid;grid-template-columns:208px 1fr;gap:0;max-width:1180px;margin:0 auto">'
      + '<aside class="dlrail" style="padding:22px 14px">' + nav
      + '<div style="margin-top:16px;padding:12px;border-radius:12px;background:' + INSET + ';border:1px solid ' + LINE + ';font-size:11px;color:' + MUT + ';line-height:1.6">Trained on ' + (D.metrics.pa / 1000).toFixed(0) + 'k synthetic PAs across ' + D.metrics.players + ' players. Connect live Statcast to go real.</div></aside>'
      + '<main style="padding:22px 26px 90px;min-height:70vh">' + main + '</main></div></div>';
  }

  function openOverlay() {
    if (!overlay) {
      overlay = document.createElement('div'); overlay.id = 'dl-hr-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow-y:auto;background:' + BG + ';color:' + TXT + ';font-family:' + FB + ';display:none';
      document.body.appendChild(overlay);
      var st = document.createElement('style');
      st.textContent = '#dl-hr-overlay *{box-sizing:border-box}#dl-hr-overlay ::-webkit-scrollbar{width:10px;height:10px}#dl-hr-overlay ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:20px;border:2px solid #0a0c11}#dl-hr-overlay input:focus{outline:1px solid ' + AC + '}@media(max-width:820px){#dl-hr-shell{grid-template-columns:1fr!important}.dlrail{display:none!important}#dl-hr-overlay main{padding:16px 14px 90px!important}#dl-hr-overlay h1{font-size:22px!important}}';
      document.head.appendChild(st);
      overlay.addEventListener('click', onClick);
      overlay.addEventListener('input', function (e) { var el = e.target.closest('[data-act="q"]'); if (el) { state.q = el.value; var rows = overlay.querySelector('main'); } });
    }
    state.open = true; overlay.style.display = 'block'; document.body.style.overflow = 'hidden'; render(); overlay.scrollTop = 0;
  }
  function closeOverlay() { state.open = false; if (overlay) overlay.style.display = 'none'; document.body.style.overflow = ''; }
  function onClick(e) {
    var el = e.target.closest('[data-act]'); if (!el) return; var act = el.getAttribute('data-act');
    if (act === 'close') return closeOverlay();
    if (act === 'tab') { state.tab = el.getAttribute('data-t'); state.sel = null; return render(); }
    if (act === 'min') { state.min = parseFloat(el.getAttribute('data-v')); return render(); }
    if (act === 'open') { var r = BOARD[parseInt(el.getAttribute('data-i'), 10)]; state.sel = r; state.sim = simulate(r.h, r.p, r.pf, r.wx, r.h.bats, r.p.throws, 10000, r.h.id * 1000 + r.p.id); return render(); }
    if (act === 'back') { state.sel = null; return render(); }
    if (act === 'q') return; // handled by input
  }
  // live search without losing focus: re-render on Enter / debounce
  document.addEventListener('input', function (e) {
    if (!state.open) return; var el = e.target && e.target.closest && e.target.closest('#dl-hr-overlay [data-act="q"]');
    if (!el) return; state.q = el.value; clearTimeout(window.__dlhrT); window.__dlhrT = setTimeout(function () { var pos = el.selectionStart; render(); var ni = overlay.querySelector('[data-act="q"]'); if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (x) {} } }, 180);
  });

  // ---------------------------------------------------------------- launcher
  function currentSport() { try { return localStorage.getItem('dl_sport') || 'mlb'; } catch (e) { return 'mlb'; } }
  function ensureFab() {
    var fab = document.getElementById('dl-hr-fab');
    var soccerOpen = (function () { var o = document.getElementById('dl-soccer-overlay'); return o && o.style.display !== 'none' && o.style.display !== ''; })();
    var show = currentSport() === 'mlb' && !state.open && !soccerOpen;
    if (!fab) {
      fab = document.createElement('button'); fab.id = 'dl-hr-fab';
      fab.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:100001;display:flex;align-items:center;gap:9px;padding:12px 18px;border:none;border-radius:30px;cursor:pointer;font-family:' + FB + ';font-weight:800;font-size:14px;color:#0a0c11;background:linear-gradient(135deg,' + AC + ',' + GOLD + ');box-shadow:0 8px 24px rgba(255,138,76,.4)';
      fab.innerHTML = '\uD83D\uDD2E HR Engine';
      fab.addEventListener('click', openOverlay);
      document.body.appendChild(fab);
    }
    fab.style.display = show ? 'flex' : 'none';
  }

  function boot() { if (!D) { return; } buildBoard(); ensureFab(); setInterval(ensureFab, 900); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
