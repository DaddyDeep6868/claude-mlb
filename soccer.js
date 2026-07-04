/*
 * soccer.js - DingerLab Soccer (World Cup 2026) module.
 *
 * Self-contained, dependency-free (no React needed). Injects a top-level
 * MLB <-> Soccer switcher and a full-screen soccer view that mirrors the
 * MLB app's design language: Space Grotesk / Hanken Grotesk typography,
 * radial-gradient stage, 208px left-rail nav, dashboard with eyebrow +
 * big h1 + stat cards + gold "locks" banner + accent-bar section headers.
 *
 * DATA: pulls LIVE matchups, kickoff dates and odds from OddsBlaze through
 * the same server proxy the MLB app uses (/api/oddsblaze). Markets: Anytime
 * Goalscorer (Player Goals Over 0.5), Match Result (3-way Moneyline),
 * Over/Under 2.5 Goals, Both Teams To Score and Corners. Fair probabilities
 * are de-vigged from the market; edges compare the best price to consensus.
 * If the proxy is unreachable (e.g. opened offline) it falls back to a real
 * Round-of-16 sample slate priced by an internal model.
 */
(function () {
  'use strict';
  if (window.__DL_SOCCER__) return;
  window.__DL_SOCCER__ = true;

  // ---- MLB design tokens (mirrored) ----
  var AC = '#ff8a4c';   // accent orange (var --ac)
  var PINK = '#ff4d7d';
  var POS = '#35d0c0';  // teal (var --pos)
  var GOLD = '#ffc24d';
  var NEG = '#ff6b6b';
  var BG = '#0a0c11';
  var CARD = '#13161e';
  var INSET = '#0c0e14';
  var INSET2 = '#0f1218';
  var TXT = '#eef1f6';
  var MUT = '#7b8597';
  var MUT2 = '#8b94a6';
  var MUT3 = '#9aa3b2';
  var LINE = 'rgba(255,255,255,.07)';
  var FH = "'Space Grotesk',ui-sans-serif,system-ui,sans-serif"; // headings/numbers
  var FB = "'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif"; // body
  var LIVE_MIN = 118;

  // ---- OddsBlaze live wiring ----
  var BOOKS = ['draftkings', 'fanatics', 'betmgm', 'caesars'];
  var LEAGUE_SLUGS = window.DL_SOCCER_LEAGUE ? [window.DL_SOCCER_LEAGUE] : ['fifa_world_cup', 'world_cup', 'fifa-world-cup', 'fifaworldcup', 'fifa'];
  var LIVE = null;            // { matches, mk, matchGs } when odds are loaded
  var LIVE_STATE = 'idle';    // idle | loading | ok | fail
  var LIVE_LEAGUE = '';
  function proxyBase() { try { var p = localStorage.getItem('dl_odds_proxy'); if (p) return p.replace(/\/+$/, ''); } catch (e) {} if (window.DL_SERVER_MODE) return ''; return 'https://claude-mlb.onrender.com'; }

  // ---------------------------------------------------------------- helpers
  function seed(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fact(n) { var f = 1; for (var i = 2; i <= n; i++) f *= i; return f; }
  function pois(k, l) { return Math.exp(-l) * Math.pow(l, k) / fact(k); }
  function poisAtMost(k, l) { var s = 0; for (var i = 0; i <= k; i++) s += pois(i, l); return s; }
  function americanFromProb(p) { p = clamp(p, 0.01, 0.985); return p >= 0.5 ? Math.round(-(p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100); }
  function impliedProb(am) { am = Number(am); if (!isFinite(am) || am === 0) return 0; return am > 0 ? 100 / (am + 100) : (-am) / ((-am) + 100); }
  function profitPer100(am) { return am > 0 ? am : 10000 / (-am); }
  function betterAm(a, b) { return profitPer100(a) > profitPer100(b); }
  function fmtAm(am) { return (am > 0 ? '+' : '') + am; }
  function pct(p) { return (p * 100).toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function normName(s) { return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function flag(cc) { cc = String(cc || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(cc)) return '\uD83C\uDFF3'; return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65); }
  // market(): compute a book price + edge/ev/score. If realAm is supplied we use
  // the real market price and treat `prob` as the fair (model / de-vigged) prob.
  function market(prob, key, realAm) {
    var am, bookProb;
    if (realAm != null && isFinite(realAm) && realAm !== 0) { am = realAm; bookProb = impliedProb(am); }
    else { var margin = (seed(key) - 0.42) * 0.22; bookProb = clamp(prob * (1 + margin), 0.02, 0.96); am = americanFromProb(bookProb); }
    var edge = prob - bookProb;
    var ev = prob * profitPer100(am) - (1 - prob) * 100;
    var score = clamp(Math.round(38 + edge * 340 + prob * 46), 1, 99);
    return { am: am, bookProb: bookProb, edge: edge, ev: ev, score: score, live: realAm != null };
  }
  function fmtTime(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayLabel(d) { var now = new Date(); var tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); if (sameDay(d, now)) return 'Today'; if (sameDay(d, tm)) return 'Tomorrow'; return d.toLocaleDateString(undefined, { weekday: 'long' }); }
  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function idk(m) { return m.id || m.h; }
  function statusOf(d, liveFlag) {
    var now = Date.now(), k = d.getTime();
    if (now < k) { var mins = Math.round((k - now) / 60000); var rel = mins < 60 ? ('in ' + mins + 'm') : mins < 1440 ? ('in ' + Math.round(mins / 60) + 'h') : dayLabel(d); return { key: 'up', label: fmtTime(d), rel: rel, color: MUT, dot: MUT }; }
    if (liveFlag || now < k + LIVE_MIN * 60000) { var el = Math.round((now - k) / 60000); return { key: 'live', label: 'LIVE ' + (el > 90 ? '90+' : Math.max(el, 1)) + "'", rel: 'in play', color: NEG, dot: NEG }; }
    return { key: 'ft', label: 'FT', rel: 'full time', color: MUT, dot: '#3a4150' };
  }
  function stageFromDate(d) {
    var m = d.getMonth(), day = d.getDate();
    if (m === 6) { if (day >= 19) return 'Final'; if (day >= 18) return 'Third place'; if (day >= 14) return 'Semi-final'; if (day >= 9) return 'Quarter-final'; if (day >= 4) return 'Round of 16'; return 'Round of 32'; }
    if (m === 5 && day >= 28) return 'Round of 32';
    return 'Group Stage';
  }
  var _ver = null;
  function appVersion() { if (_ver !== null) return _ver; _ver = ''; try { if (window.__DL_VERSION__) { _ver = window.__DL_VERSION__; return _ver; } var s = document.querySelector('script[type="__bundler/template"]'); if (s) { var m = s.textContent.match(/>v(\d+\.\d+\.\d+)</); if (m) _ver = 'v' + m[1]; } } catch (e) {} return _ver; }

  // ---------------------------------------------------------------- nation table (flags + model ratings)
  var NAT = {
    'argentina': ['AR', 1.42, 1.30, 5.6], 'france': ['FR', 1.48, 1.28, 5.9], 'brazil': ['BR', 1.44, 1.22, 6.2],
    'england': ['GB', 1.38, 1.26, 6.0], 'spain': ['ES', 1.46, 1.24, 6.6], 'portugal': ['PT', 1.40, 1.18, 6.1],
    'netherlands': ['NL', 1.30, 1.20, 5.4], 'germany': ['DE', 1.34, 1.16, 6.3], 'usa': ['US', 1.10, 1.06, 4.9],
    'united states': ['US', 1.10, 1.06, 4.9], 'mexico': ['MX', 1.05, 1.02, 4.9], 'canada': ['CA', 1.02, 0.98, 4.6],
    'uruguay': ['UY', 1.18, 1.14, 5.0], 'croatia': ['HR', 1.14, 1.12, 5.1], 'belgium': ['BE', 1.24, 1.08, 5.3],
    'morocco': ['MA', 1.10, 1.20, 4.7], 'japan': ['JP', 1.06, 1.04, 4.9], 'norway': ['NO', 1.28, 1.06, 5.2],
    'paraguay': ['PY', 0.98, 1.10, 4.5], 'egypt': ['EG', 1.10, 1.08, 4.8], 'switzerland': ['CH', 1.08, 1.12, 4.9],
    'colombia': ['CO', 1.22, 1.14, 5.4], 'south korea': ['KR', 1.04, 1.02, 4.8], 'korea republic': ['KR', 1.04, 1.02, 4.8],
    'senegal': ['SN', 1.14, 1.10, 4.9], 'ecuador': ['EC', 1.02, 1.08, 4.6], 'australia': ['AU', 0.98, 1.02, 4.7],
    'denmark': ['DK', 1.16, 1.12, 5.2], 'italy': ['IT', 1.30, 1.24, 5.8], 'ivory coast': ['CI', 1.06, 1.02, 4.8],
    'cote d ivoire': ['CI', 1.06, 1.02, 4.8], 'nigeria': ['NG', 1.10, 1.04, 4.9], 'ghana': ['GH', 1.02, 0.98, 4.7],
    'cameroon': ['CM', 1.04, 1.00, 4.8], 'tunisia': ['TN', 0.96, 1.08, 4.5], 'algeria': ['DZ', 1.08, 1.05, 4.9],
    'saudi arabia': ['SA', 0.95, 1.00, 4.5], 'iran': ['IR', 1.00, 1.10, 4.6], 'ir iran': ['IR', 1.00, 1.10, 4.6],
    'qatar': ['QA', 0.92, 0.98, 4.4], 'poland': ['PL', 1.10, 1.06, 5.0], 'serbia': ['RS', 1.14, 1.06, 5.2],
    'austria': ['AT', 1.12, 1.08, 5.1], 'turkey': ['TR', 1.10, 1.05, 5.1], 'turkiye': ['TR', 1.10, 1.05, 5.1],
    'sweden': ['SE', 1.12, 1.10, 5.1], 'panama': ['PA', 0.90, 0.98, 4.4], 'costa rica': ['CR', 0.95, 1.00, 4.5],
    'south africa': ['ZA', 0.98, 1.00, 4.6], 'czechia': ['CZ', 1.10, 1.06, 5.1], 'czech republic': ['CZ', 1.10, 1.06, 5.1],
    'peru': ['PE', 0.98, 1.04, 4.6], 'chile': ['CL', 1.02, 1.06, 4.8], 'new zealand': ['NZ', 0.85, 0.95, 4.3],
    'cabo verde': ['CV', 0.90, 0.98, 4.4], 'cape verde': ['CV', 0.90, 0.98, 4.4], 'curacao': ['CW', 0.85, 0.95, 4.2],
    'haiti': ['HT', 0.85, 0.92, 4.2], 'jordan': ['JO', 0.88, 0.98, 4.3], 'uzbekistan': ['UZ', 0.92, 1.00, 4.4],
    'dr congo': ['CD', 1.00, 1.00, 4.6], 'scotland': ['GB', 1.08, 1.06, 5.0], 'wales': ['GB', 1.02, 1.04, 4.9]
  };
  function natInfo(name) { var k = normName(name); var v = NAT[k]; if (!v) return { cc: '', atk: 1.08, def: 1.08, corners: 5.0 }; return { cc: v[0], atk: v[1], def: v[2], corners: v[3] }; }
  function teamCode(t) { var ab = (t && t.abbreviation ? String(t.abbreviation) : '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (ab) return ab; var n = normName(t && t.name).replace(/[^a-z]/g, ''); return (n.slice(0, 3) || 'TBD').toUpperCase(); }

  // ---------------------------------------------------------------- data (offline sample fallback = real Round of 16)
  var TEAMS = {
    CAN: { name: 'Canada', flag: '\uD83C\uDDE8\uD83C\uDDE6', atk: 1.02, def: 0.98, corners: 4.6 },
    MAR: { name: 'Morocco', flag: '\uD83C\uDDF2\uD83C\uDDE6', atk: 1.10, def: 1.20, corners: 4.7 },
    FRA: { name: 'France', flag: '\uD83C\uDDEB\uD83C\uDDF7', atk: 1.48, def: 1.28, corners: 5.9 },
    PAR: { name: 'Paraguay', flag: '\uD83C\uDDF5\uD83C\uDDFE', atk: 0.98, def: 1.10, corners: 4.5 },
    BRA: { name: 'Brazil', flag: '\uD83C\uDDE7\uD83C\uDDF7', atk: 1.44, def: 1.22, corners: 6.2 },
    NOR: { name: 'Norway', flag: '\uD83C\uDDF3\uD83C\uDDF4', atk: 1.28, def: 1.06, corners: 5.2 },
    MEX: { name: 'Mexico', flag: '\uD83C\uDDF2\uD83C\uDDFD', atk: 1.05, def: 1.02, corners: 4.9 },
    ENG: { name: 'England', flag: '\uD83C\uDDEC\uD83C\uDDE7', atk: 1.38, def: 1.26, corners: 6.0 },
    ESP: { name: 'Spain', flag: '\uD83C\uDDEA\uD83C\uDDF8', atk: 1.46, def: 1.24, corners: 6.6 },
    POR: { name: 'Portugal', flag: '\uD83C\uDDF5\uD83C\uDDF9', atk: 1.40, def: 1.18, corners: 6.1 },
    USA: { name: 'USA', flag: '\uD83C\uDDFA\uD83C\uDDF8', atk: 1.10, def: 1.06, corners: 4.9 },
    BEL: { name: 'Belgium', flag: '\uD83C\uDDE7\uD83C\uDDEA', atk: 1.24, def: 1.08, corners: 5.3 },
    ARG: { name: 'Argentina', flag: '\uD83C\uDDE6\uD83C\uDDF7', atk: 1.42, def: 1.30, corners: 5.6 },
    EGY: { name: 'Egypt', flag: '\uD83C\uDDEA\uD83C\uDDEC', atk: 1.10, def: 1.08, corners: 4.8 },
    SUI: { name: 'Switzerland', flag: '\uD83C\uDDE8\uD83C\uDDED', atk: 1.08, def: 1.12, corners: 4.9 },
    COL: { name: 'Colombia', flag: '\uD83C\uDDE8\uD83C\uDDF4', atk: 1.22, def: 1.14, corners: 5.4 }
  };
  var PLAYERS = [
    { n: 'Jonathan David', t: 'CAN', pos: 'FW', threat: 0.44, min: 0.90 }, { n: 'Alphonso Davies', t: 'CAN', pos: 'DF', threat: 0.26, min: 0.90 }, { n: 'Cyle Larin', t: 'CAN', pos: 'FW', threat: 0.34, min: 0.66 },
    { n: 'Youssef En-Nesyri', t: 'MAR', pos: 'FW', threat: 0.44, min: 0.86 }, { n: 'Achraf Hakimi', t: 'MAR', pos: 'DF', threat: 0.30, min: 0.92 }, { n: 'Brahim Diaz', t: 'MAR', pos: 'MF', threat: 0.36, min: 0.80 },
    { n: 'Kylian Mbappe', t: 'FRA', pos: 'FW', threat: 0.78, min: 0.94 }, { n: 'Ousmane Dembele', t: 'FRA', pos: 'FW', threat: 0.48, min: 0.82 }, { n: 'Michael Olise', t: 'FRA', pos: 'FW', threat: 0.42, min: 0.78 },
    { n: 'Antonio Sanabria', t: 'PAR', pos: 'FW', threat: 0.38, min: 0.80 }, { n: 'Julio Enciso', t: 'PAR', pos: 'FW', threat: 0.36, min: 0.72 }, { n: 'Miguel Almiron', t: 'PAR', pos: 'MF', threat: 0.34, min: 0.85 },
    { n: 'Vinicius Jr', t: 'BRA', pos: 'FW', threat: 0.60, min: 0.90 }, { n: 'Rodrygo', t: 'BRA', pos: 'FW', threat: 0.50, min: 0.85 }, { n: 'Endrick', t: 'BRA', pos: 'FW', threat: 0.46, min: 0.60 },
    { n: 'Erling Haaland', t: 'NOR', pos: 'FW', threat: 0.80, min: 0.95 }, { n: 'Martin Odegaard', t: 'NOR', pos: 'MF', threat: 0.44, min: 0.90 }, { n: 'Alexander Sorloth', t: 'NOR', pos: 'FW', threat: 0.42, min: 0.70 },
    { n: 'Santiago Gimenez', t: 'MEX', pos: 'FW', threat: 0.40, min: 0.82 }, { n: 'Raul Jimenez', t: 'MEX', pos: 'FW', threat: 0.38, min: 0.78 }, { n: 'Hirving Lozano', t: 'MEX', pos: 'FW', threat: 0.36, min: 0.80 },
    { n: 'Harry Kane', t: 'ENG', pos: 'FW', threat: 0.70, min: 0.95 }, { n: 'Jude Bellingham', t: 'ENG', pos: 'MF', threat: 0.52, min: 0.92 }, { n: 'Bukayo Saka', t: 'ENG', pos: 'FW', threat: 0.46, min: 0.88 },
    { n: 'Lamine Yamal', t: 'ESP', pos: 'FW', threat: 0.54, min: 0.88 }, { n: 'Alvaro Morata', t: 'ESP', pos: 'FW', threat: 0.50, min: 0.80 }, { n: 'Nico Williams', t: 'ESP', pos: 'FW', threat: 0.44, min: 0.82 },
    { n: 'Cristiano Ronaldo', t: 'POR', pos: 'FW', threat: 0.56, min: 0.85 }, { n: 'Bruno Fernandes', t: 'POR', pos: 'MF', threat: 0.44, min: 0.90 }, { n: 'Rafael Leao', t: 'POR', pos: 'FW', threat: 0.46, min: 0.78 },
    { n: 'Christian Pulisic', t: 'USA', pos: 'FW', threat: 0.46, min: 0.92 }, { n: 'Folarin Balogun', t: 'USA', pos: 'FW', threat: 0.38, min: 0.80 }, { n: 'Weston McKennie', t: 'USA', pos: 'MF', threat: 0.30, min: 0.86 },
    { n: 'Romelu Lukaku', t: 'BEL', pos: 'FW', threat: 0.50, min: 0.85 }, { n: 'Kevin De Bruyne', t: 'BEL', pos: 'MF', threat: 0.44, min: 0.86 }, { n: 'Jeremy Doku', t: 'BEL', pos: 'FW', threat: 0.38, min: 0.78 },
    { n: 'Lionel Messi', t: 'ARG', pos: 'FW', threat: 0.62, min: 0.90 }, { n: 'Julian Alvarez', t: 'ARG', pos: 'FW', threat: 0.58, min: 0.92 }, { n: 'Lautaro Martinez', t: 'ARG', pos: 'FW', threat: 0.55, min: 0.80 },
    { n: 'Mohamed Salah', t: 'EGY', pos: 'FW', threat: 0.68, min: 0.92 }, { n: 'Omar Marmoush', t: 'EGY', pos: 'FW', threat: 0.46, min: 0.84 }, { n: 'Trezeguet', t: 'EGY', pos: 'FW', threat: 0.32, min: 0.72 },
    { n: 'Breel Embolo', t: 'SUI', pos: 'FW', threat: 0.42, min: 0.82 }, { n: 'Dan Ndoye', t: 'SUI', pos: 'FW', threat: 0.38, min: 0.80 }, { n: 'Xherdan Shaqiri', t: 'SUI', pos: 'MF', threat: 0.34, min: 0.72 },
    { n: 'Luis Diaz', t: 'COL', pos: 'FW', threat: 0.56, min: 0.90 }, { n: 'Jhon Duran', t: 'COL', pos: 'FW', threat: 0.44, min: 0.66 }, { n: 'James Rodriguez', t: 'COL', pos: 'MF', threat: 0.40, min: 0.85 }
  ];
  // Real FIFA World Cup 2026 Round of 16 fixtures (kickoffs in ET / UTC-4).
  var FIXTURES = [
    { h: 'CAN', a: 'MAR', iso: '2026-07-04T13:00:00-04:00', venue: 'NRG Stadium, Houston' },
    { h: 'FRA', a: 'PAR', iso: '2026-07-04T17:00:00-04:00', venue: 'Lincoln Financial Field, Philadelphia' },
    { h: 'BRA', a: 'NOR', iso: '2026-07-05T16:00:00-04:00', venue: 'MetLife Stadium, New Jersey' },
    { h: 'MEX', a: 'ENG', iso: '2026-07-05T20:00:00-04:00', venue: 'Estadio Azteca, Mexico City' },
    { h: 'ESP', a: 'POR', iso: '2026-07-06T15:00:00-04:00', venue: 'AT&T Stadium, Dallas' },
    { h: 'USA', a: 'BEL', iso: '2026-07-06T20:00:00-04:00', venue: 'Lumen Field, Seattle' },
    { h: 'ARG', a: 'EGY', iso: '2026-07-07T12:00:00-04:00', venue: 'Mercedes-Benz Stadium, Atlanta' },
    { h: 'SUI', a: 'COL', iso: '2026-07-07T16:00:00-04:00', venue: 'BC Place, Vancouver' }
  ];
  function buildMatches() { return FIXTURES.map(function (f) { return { h: f.h, a: f.a, date: new Date(f.iso), stage: 'Round of 16', venue: f.venue }; }); }
  var MATCHES = buildMatches();

  // ---------------------------------------------------------------- live odds (OddsBlaze)
  function loadLive(force) {
    if (LIVE_STATE === 'loading') return;
    if (LIVE_STATE === 'ok' && !force) { /* allow periodic refresh via force */ }
    LIVE_STATE = 'loading'; safeRender();
    var base = proxyBase();
    (function tryNext(i) {
      if (i >= LEAGUE_SLUGS.length) { LIVE_STATE = LIVE ? 'ok' : 'fail'; safeRender(); return; }
      var slug = LEAGUE_SLUGS[i];
      Promise.all(BOOKS.map(function (bk) {
        return fetch(base + '/api/oddsblaze?sportsbook=' + bk + '&league=' + encodeURIComponent(slug))
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      })).then(function (jsons) {
        var built = buildLive(jsons, BOOKS);
        if (built && built.matches.length) {
          Object.assign(TEAMS, built.teams);
          MATCHES = built.matches;
          LIVE = { matches: built.matches, mk: built.mk, matchGs: built.matchGs };
          LIVE_LEAGUE = slug; LIVE_STATE = 'ok'; safeRender();
        } else { tryNext(i + 1); }
      }).catch(function () { tryNext(i + 1); });
    })(0);
  }
  function buildLive(jsons, books) {
    var byId = {}, any = false;
    (jsons || []).forEach(function (j, bi) {
      if (!j || !Array.isArray(j.events)) return; any = true; var book = (books && books[bi]) || ("book" + bi);
      j.events.forEach(function (ev) {
        if (!ev || !ev.id || !ev.teams || !ev.teams.home || !ev.teams.away) return;
        var slot = byId[ev.id]; if (!slot) slot = byId[ev.id] = { ev: ev, odds: {} };
        (ev.odds || []).forEach(function (o) {
          if (o == null || o.price == null) return; var am = parseInt(String(o.price), 10); if (!isFinite(am) || am === 0) return;
          var sel = o.selection || {};
          var key = (o.market || '') + '|' + (o.name || sel.name || '') + '|' + (sel.side || '') + '|' + (sel.line == null ? '' : sel.line);
          var e = slot.odds[key]; if (!e) e = slot.odds[key] = { market: o.market || '', name: o.name || (sel.name || ''), side: sel.side || '', line: sel.line, player: o.player || null, best: am, sumImp: 0, cnt: 0, books: {} };
          if (betterAm(am, e.best)) e.best = am;
          var _pb = e.books[book]; if (_pb == null || betterAm(am, _pb)) e.books[book] = am;
          e.sumImp += impliedProb(am); e.cnt++;
        });
      });
    });
    if (!any) return null;
    var teams = {}, matches = [], mk = {}, matchGs = {};
    function ensure(t) { var code = teamCode(t); if (!teams[code]) { var info = natInfo(t.name); teams[code] = { name: t.name, flag: flag(info.cc), atk: info.atk, def: info.def, corners: info.corners, _live: true }; } return code; }
    Object.keys(byId).forEach(function (id) {
      var slot = byId[id], ev = slot.ev;
      var hN = ev.teams.home.name, aN = ev.teams.away.name;
      var hC = ensure(ev.teams.home), aC = ensure(ev.teams.away);
      var date = new Date(ev.date);
      if (isNaN(date.getTime())) return;
      matches.push({ id: id, h: hC, a: aC, date: date, stage: stageFromDate(date), venue: '', live: !!ev.live });
      var o = { id: id }; var gsList = [];
      Object.keys(slot.odds).forEach(function (k) {
        var e = slot.odds[k]; var m = (e.market || '').toLowerCase(); var nm = normName(e.name); var side = (e.side || '').toLowerCase(); var line = e.line;
        var avg = e.cnt ? e.sumImp / e.cnt : impliedProb(e.best);
        // Anytime goalscorer: Player Goals Over 0.5
        if (/goal/.test(m) && e.player && e.player.name && side === 'over' && Number(line) === 0.5 && !/team/.test(m)) {
          var ptn = e.player.team ? e.player.team.name : ''; var pside = normName(ptn) === normName(hN) ? 'h' : normName(ptn) === normName(aN) ? 'a' : '';
          gsList.push({ name: e.player.name, side: pside, best: e.best, avg: avg, books: e.books }); return;
        }
        // 3-way match result / moneyline
        if (/moneyline|match result|full time result|1x2|match winner|to win|match odds/.test(m) && side !== 'over' && side !== 'under') {
          if (/draw|tie/.test(nm)) { o.amD = e.best; o.pD = avg; o.bkD = e.books; }
          else if (nm === normName(hN) || nm.indexOf(normName(hN)) >= 0) { o.amH = e.best; o.pH = avg; o.bkH = e.books; }
          else if (nm === normName(aN) || nm.indexOf(normName(aN)) >= 0) { o.amA = e.best; o.pA = avg; o.bkA = e.books; }
          return;
        }
        // Total goals 2.5
        if (/total/.test(m) && /goal/.test(m) && Number(line) === 2.5) { if (side === 'over') { o.amO25 = e.best; o.pO25 = avg; o.bkO25 = e.books; } else if (side === 'under') { o.amU25 = e.best; o.pU25 = avg; o.bkU25 = e.books; } return; }
        // Both teams to score
        if (/both teams to score|btts/.test(m)) { if (/yes/.test(nm) || /yes/.test(side)) { o.amBTTS = e.best; o.pBTTS = avg; o.bkBTTS = e.books; } return; }
        // Corners (total 9.5 + team totals)
        if (/corner/.test(m) && (side === 'over' || side === 'under')) {
          var hHit = normName(hN) && nm.indexOf(normName(hN)) >= 0, aHit = normName(aN) && nm.indexOf(normName(aN)) >= 0;
          if (/team/.test(m) || hHit || aHit || /home|away/.test(nm)) {
            var tside = (hHit || /home/.test(nm)) ? 'h' : ((aHit || /away/.test(nm)) ? 'a' : '');
            if (tside === 'h') { if (side === 'over') { o.amHCo = e.best; o.pHCo = avg; o.bkHCo = e.books; o.hcLine = line; } else { o.amHCu = e.best; o.pHCu = avg; o.bkHCu = e.books; if (o.hcLine == null) o.hcLine = line; } return; }
            if (tside === 'a') { if (side === 'over') { o.amACo = e.best; o.pACo = avg; o.bkACo = e.books; o.acLine = line; } else { o.amACu = e.best; o.pACu = avg; o.bkACu = e.books; if (o.acLine == null) o.acLine = line; } return; }
          }
          if (Number(line) === 9.5) { if (side === 'over') { o.amC9o = e.best; o.pC9o = avg; o.bkC9o = e.books; } else if (side === 'under') { o.amC9u = e.best; o.pC9u = avg; o.bkC9u = e.books; } }
          return;
        }
      });
      mk[id] = o; matchGs[id] = gsList;
    });
    matches.sort(function (a, b) { return a.date - b.date; });
    return { teams: teams, matches: matches, mk: mk, matchGs: matchGs };
  }

  // ---------------------------------------------------------------- models
  function oppMap() { var o = {}; MATCHES.forEach(function (m) { o[m.h] = { opp: m.a, home: true, m: m }; o[m.a] = { opp: m.h, home: false, m: m }; }); return o; }
  function poissonModel(m) {
    var H = TEAMS[m.h], A = TEAMS[m.a], BASE = 1.35;
    var xgH = BASE * (H.atk / A.def) * 1.08, xgA = BASE * (A.atk / H.def) * 0.95;
    var pH = 0, pD = 0, pA = 0, N = 8;
    for (var i = 0; i <= N; i++) for (var j = 0; j <= N; j++) { var pr = pois(i, xgH) * pois(j, xgA); if (i > j) pH += pr; else if (i === j) pD += pr; else pA += pr; }
    var tot = xgH + xgA, over25 = 1 - poisAtMost(2, tot);
    var btts = (1 - poisAtMost(0, xgH)) * (1 - poisAtMost(0, xgA));
    var cxH = H.corners * (H.atk / A.def), cxA = A.corners * (A.atk / H.def);
    var cxTot = cxH + cxA;
    var over95c = 1 - poisAtMost(9, cxTot);
    var overHc = 1 - poisAtMost(4, cxH), overAc = 1 - poisAtMost(4, cxA);
    return { xgH: xgH, xgA: xgA, pH: pH, pD: pD, pA: pA, over25: over25, under25: 1 - over25, btts: btts, cxTot: cxTot, cxH: cxH, cxA: cxA, over95c: over95c, under95c: 1 - over95c, hcLine: 4.5, acLine: 4.5, overHc: overHc, underHc: 1 - overHc, overAc: overAc, underAc: 1 - overAc, live: false };
  }
  function matchModel(m) {
    var mm = poissonModel(m);
    var o = (LIVE && m.id && LIVE.mk) ? LIVE.mk[m.id] : null;
    if (!o) return mm;
    mm.live = true;
    // de-vig 3-way result when all three prices present
    if (o.amH != null && o.amD != null && o.amA != null) {
      var s = o.pH + o.pD + o.pA; if (s > 0) { mm.pH = o.pH / s; mm.pD = o.pD / s; mm.pA = o.pA / s; }
      mm.amH = o.amH; mm.amD = o.amD; mm.amA = o.amA;
      var totG = mm.xgH + mm.xgA; mm.xgH = totG * (mm.pH + mm.pD / 2) / (mm.pH + mm.pA + mm.pD); mm.xgA = totG - mm.xgH;
    }
    if (o.amO25 != null) { mm.amO25 = o.amO25; if (o.amU25 != null) { var st = o.pO25 + o.pU25; if (st > 0) { mm.over25 = o.pO25 / st; mm.under25 = o.pU25 / st; } } else { mm.over25 = o.pO25; mm.under25 = 1 - o.pO25; } }
    if (o.amU25 != null) mm.amU25 = o.amU25;
    if (o.amBTTS != null) { mm.amBTTS = o.amBTTS; mm.btts = o.pBTTS; }
    if (o.amC9o != null) { mm.amC9o = o.amC9o; mm.over95c = o.pC9o; mm.under95c = 1 - o.pC9o; }
    if (o.amC9u != null) { mm.amC9u = o.amC9u; if (o.pC9u != null) { mm.under95c = o.pC9u; mm.over95c = 1 - o.pC9u; } }
    if (o.hcLine != null) mm.hcLine = o.hcLine;
    if (o.acLine != null) mm.acLine = o.acLine;
    if (o.amHCo != null) { mm.amHCo = o.amHCo; if (o.pHCo != null) mm.overHc = o.pHCo; }
    if (o.amHCu != null) { mm.amHCu = o.amHCu; if (o.pHCu != null) { mm.underHc = o.pHCu; if (o.pHCo != null) { var _sh = o.pHCo + o.pHCu; if (_sh > 0) { mm.overHc = o.pHCo / _sh; mm.underHc = o.pHCu / _sh; } } } }
    if (o.amACo != null) { mm.amACo = o.amACo; if (o.pACo != null) mm.overAc = o.pACo; }
    if (o.amACu != null) { mm.amACu = o.amACu; if (o.pACu != null) { mm.underAc = o.pACu; if (o.pACo != null) { var _sa = o.pACo + o.pACu; if (_sa > 0) { mm.overAc = o.pACo / _sa; mm.underAc = o.pACu / _sa; } } } }
    return mm;
  }
  function modelGoalscorers() {
    var opp = oppMap(); var out = [];
    PLAYERS.forEach(function (p) {
      var fx = opp[p.t]; if (!fx) return; var team = TEAMS[p.t], op = TEAMS[fx.opp]; if (!team || !op) return;
      var lam = p.threat * (team.atk / op.def) * p.min * (fx.home ? 1.06 : 0.97);
      var prob = clamp(1 - Math.exp(-lam), 0.03, 0.85); var mk = market(prob, 'gs' + p.n);
      out.push({ name: p.n, team: p.t, teamName: team.name, flag: team.flag, pos: p.pos, opp: fx.opp, oppName: op.name, home: fx.home, date: fx.m.date, stage: fx.m.stage, prob: prob, am: mk.am, edge: mk.edge, ev: mk.ev, score: mk.score, init: initials(p.n) });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }
  function liveGoalscorers() {
    var out = [];
    MATCHES.forEach(function (m) {
      var list = LIVE.matchGs[m.id] || []; var H = TEAMS[m.h], A = TEAMS[m.a]; if (!H || !A) return;
      list.forEach(function (g) {
        var home = g.side === 'h' ? true : g.side === 'a' ? false : true;
        var teamCode2 = g.side === 'a' ? m.a : m.h, oppCode = g.side === 'a' ? m.h : m.a;
        var team = TEAMS[teamCode2], op = TEAMS[oppCode]; if (!team || !op) return;
        var prob = clamp(g.avg, 0.02, 0.95);            // fair (consensus) anytime probability
        var mk = market(prob, 'gs' + g.name, g.best);   // price = best available across books
        out.push({ name: g.name, team: teamCode2, teamName: team.name, flag: team.flag, pos: 'FW', opp: oppCode, oppName: op.name, home: home, date: m.date, stage: m.stage, prob: prob, am: mk.am, edge: mk.edge, ev: mk.ev, score: mk.score, init: initials(g.name) });
      });
    });
    // de-dupe by normalized name keeping best score
    var seen = {}; out = out.filter(function (p) { var k = normName(p.name); if (seen[k]) return false; seen[k] = 1; return true; });
    return out.sort(function (a, b) { return b.score - a.score; });
  }
  function goalscorers() { return (LIVE && LIVE.matchGs) ? liveGoalscorers() : modelGoalscorers(); }
  function initials(n) { return String(n).split(' ').map(function (w) { return w[0]; }).slice(-2).join(''); }
  function marketsForMatch(m) {
    var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a], lbl = H.name + ' v ' + A.name, K = idk(m);
    return [
      { grp: 'Result', label: H.name + ' win', prob: mm.pH, key: '1x2h' + K, am: mm.amH }, { grp: 'Result', label: 'Draw', prob: mm.pD, key: '1x2d' + K, am: mm.amD }, { grp: 'Result', label: A.name + ' win', prob: mm.pA, key: '1x2a' + K, am: mm.amA },
      { grp: 'Goals', label: 'Over 2.5 goals', prob: mm.over25, key: 'o25' + K, am: mm.amO25 }, { grp: 'Goals', label: 'Under 2.5 goals', prob: mm.under25, key: 'u25' + K, am: mm.amU25 }, { grp: 'Goals', label: 'Both teams to score', prob: mm.btts, key: 'btts' + K, am: mm.amBTTS },
      { grp: 'Corners', label: 'Over 9.5 corners', prob: mm.over95c, key: 'c9o' + K, am: mm.amC9o }, { grp: 'Corners', label: 'Under 9.5 corners', prob: mm.under95c, key: 'c9u' + K, am: mm.amC9u },
      { grp: 'Corners', label: H.name + ' over ' + (mm.hcLine || 4.5) + ' corners', prob: mm.overHc, key: 'hco' + K, am: mm.amHCo }, { grp: 'Corners', label: H.name + ' under ' + (mm.hcLine || 4.5) + ' corners', prob: mm.underHc, key: 'hcu' + K, am: mm.amHCu },
      { grp: 'Corners', label: A.name + ' over ' + (mm.acLine || 4.5) + ' corners', prob: mm.overAc, key: 'aco' + K, am: mm.amACo }, { grp: 'Corners', label: A.name + ' under ' + (mm.acLine || 4.5) + ' corners', prob: mm.underAc, key: 'acu' + K, am: mm.amACu }
    ].map(function (s) { return Object.assign(s, market(s.prob, s.key, s.am), { match: lbl, date: m.date }); });
  }
  function bestValueToday() {
    var now = new Date(); var sels = []; var thr = LIVE ? 0.005 : 0.02;
    MATCHES.filter(function (m) { return sameDay(m.date, now); }).forEach(function (m) { sels = sels.concat(marketsForMatch(m)); });
    goalscorers().filter(function (g) { return sameDay(g.date, now); }).forEach(function (g) { sels.push({ grp: 'Goalscorer', label: g.name + ' anytime', prob: g.prob, am: g.am, edge: g.edge, ev: g.ev, score: g.score, match: g.teamName + ' ' + (g.home ? 'v ' : '@ ') + g.oppName }); });
    return sels.filter(function (s) { return s.edge > thr; }).sort(function (a, b) { return b.ev - a.ev; }).slice(0, 8);
  }

  function scanAll() {
    var sels = [];
    MATCHES.forEach(function (m) { sels = sels.concat(marketsForMatch(m)); });
    goalscorers().forEach(function (g) { sels.push({ grp: 'Goalscorer', label: g.name + ' anytime', prob: g.prob, am: g.am, edge: g.edge, ev: g.ev, score: g.score, match: g.teamName + ' ' + (g.home ? 'v ' : '@ ') + g.oppName, date: g.date }); });
    return sels;
  }
  function findArbs() {
    var arbs = [];
    MATCHES.forEach(function (m) {
      var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a];
      function push(type, legs) {
        var ok = legs.every(function (l) { return l.am != null && isFinite(l.am) && l.am !== 0; });
        if (!ok) return;
        var sum = legs.reduce(function (a, l) { return a + impliedProb(l.am); }, 0);
        if (sum > 0 && sum < 0.9995) arbs.push({ match: H.name + ' v ' + A.name, type: type, legs: legs, sum: sum, roi: (1 / sum - 1) * 100, date: m.date, live: !!m.live });
      }
      push('Match Result', [{ n: H.name, am: mm.amH }, { n: 'Draw', am: mm.amD }, { n: A.name, am: mm.amA }]);
      push('Goals O/U 2.5', [{ n: 'Over 2.5', am: mm.amO25 }, { n: 'Under 2.5', am: mm.amU25 }]);
      push('Corners O/U 9.5', [{ n: 'Over 9.5', am: mm.amC9o }, { n: 'Under 9.5', am: mm.amC9u }]);
      push(H.name + ' corners', [{ n: 'Over', am: mm.amHCo }, { n: 'Under', am: mm.amHCu }]);
      push(A.name + ' corners', [{ n: 'Over', am: mm.amACo }, { n: 'Under', am: mm.amACu }]);
    });
    return arbs.sort(function (a, b) { return b.roi - a.roi; });
  }

  // ---------------------------------------------------------------- UI atoms
  function scoreColor(s) { return s >= 70 ? POS : s >= 55 ? GOLD : MUT; }
  function evColor(ev) { return ev > 5 ? POS : ev < -8 ? NEG : MUT; }
  function grpColor(g) { return g === 'Result' ? AC : g === 'Goals' ? POS : g === 'Corners' ? GOLD : PINK; }
  function edgeBadge(e) {
    if (e >= 0.05) return '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(53,208,192,.14);color:' + POS + '">VALUE</span>';
    if (e <= -0.06) return '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(255,107,107,.14);color:' + NEG + '">FADE</span>';
    return '';
  }
  function statusPill(st) { return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:' + st.color + '"><span class="' + (st.key === 'live' ? 'dlpulse' : '') + '" style="width:7px;height:7px;border-radius:50%;background:' + st.dot + '"></span>' + esc(st.label) + '</span>'; }
  function crest(code) { var t = TEAMS[code] || { flag: '\uD83C\uDFF3' }; return '<div style="width:40px;height:40px;flex:none;border-radius:50%;background:' + INSET + ';display:grid;place-items:center;font-size:20px;border:1px solid rgba(255,255,255,.08)">' + t.flag + '</div>'; }
  function sectionHead(color, title, sub, right) {
    return '<div style="display:flex;align-items:center;gap:8px;margin:26px 0 13px"><span style="width:3px;height:17px;border-radius:2px;background:' + color + ';flex:none"></span><h2 style="margin:0;font-family:' + FH + ';font-size:16px;font-weight:700">' + title + '</h2>' + (sub ? '<span style="font-size:12px;color:' + MUT + '">' + sub + '</span>' : '') + (right ? '<span style="margin-left:auto">' + right + '</span>' : '') + '</div>';
  }
  function pageHead(eyebrow, title, subtitle) {
    return '<div style="margin-bottom:18px;animation:dlrise .35s ease both"><div style="font-size:11px;letter-spacing:.14em;color:' + AC + ';font-weight:700;margin-bottom:6px">' + eyebrow + '</div>'
      + '<h1 style="margin:0;font-family:' + FH + ';font-size:30px;font-weight:700;letter-spacing:-.02em">' + title + '</h1>'
      + (subtitle ? '<p style="margin:6px 0 0;color:' + MUT2 + ';font-size:14px;max-width:560px">' + subtitle + '</p>' : '') + '</div>';
  }
  function statCard(label, value, color, sub) {
    return '<div style="padding:18px;border-radius:14px;background:' + CARD + ';border:1px solid ' + LINE + '"><div style="font-size:11.5px;color:' + MUT + ';font-weight:600;letter-spacing:.03em">' + esc(label) + '</div>'
      + '<div style="font-family:' + FH + ';font-size:30px;font-weight:700;margin-top:6px;color:' + (color || TXT) + '">' + value + '</div>'
      + '<div style="font-size:12px;color:' + MUT + ';margin-top:2px">' + esc(sub || '') + '</div></div>';
  }
  function probBar(label, p, color) {
    return '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:11px;color:' + MUT + ';font-weight:600;margin-bottom:4px"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(label) + '</span><span style="font-family:' + FH + ';color:' + color + '">' + Math.round(p * 100) + '%</span></div>'
      + '<div style="height:6px;border-radius:4px;background:' + INSET + ';overflow:hidden"><div style="height:100%;width:' + Math.round(p * 100) + '%;background:' + color + '"></div></div></div>';
  }
  function oddRow(label, prob, key, realAm, matchLbl) {
    var mk = market(prob, key, realAm);
    return '<div class="dlrow" style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:11px;background:' + INSET + ';border:1px solid ' + LINE + '">'
      + '<div style="font-size:12.5px;font-weight:600">' + esc(label) + ' ' + edgeBadge(mk.edge) + '</div>'
      + '<div style="display:flex;gap:14px;align-items:center"><span style="font-size:12px;color:' + MUT + '">' + pct(prob) + '</span>'
      + '<span style="font-family:' + FH + ';font-weight:700;font-size:15px;color:' + scoreColor(mk.score) + '">' + fmtAm(mk.am) + '</span>'
      + '<span style="font-family:' + FH + ';font-size:11.5px;color:' + evColor(mk.ev) + ';font-weight:700;width:52px;text-align:right">' + (mk.ev > 0 ? '+' : '') + mk.ev.toFixed(1) + '</span>' + addBtn(key, label, matchLbl, mk.am, prob) + '</div></div>';
  }

  // ---- switcher (matches MLB pill toggles) ----
  function switcher(active) {
    function b(id, label) { var on = active === id; return '<button class="dlbtn" data-act="sport" data-sport="' + id + '" style="padding:7px 13px;border:none;border-radius:8px;font-family:' + FB + ';font-weight:700;font-size:12.5px;cursor:pointer;background:' + (on ? AC : 'transparent') + ';color:' + (on ? '#0a0c11' : MUT) + '">' + label + '</button>'; }
    return '<div style="display:inline-flex;gap:3px;padding:3px;border-radius:10px;background:' + CARD + ';border:1px solid rgba(255,255,255,.09)">' + b('mlb', '\u26BE MLB') + b('soccer', '\u26BD Soccer') + '</div>';
  }

  // ---------------------------------------------------------------- cards
  function matchCardFull(m, opts) {
    var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a], st = statusOf(m.date, m.live), K = idk(m), cl = H.name + ' v ' + A.name;
    var meta = esc(m.stage) + ' \u00B7 ' + dayLabel(m.date) + ' ' + fmtTime(m.date) + (m.venue ? ' \u00B7 ' + esc(m.venue) : '');
    var head = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div style="display:flex;align-items:center;gap:11px;min-width:0">' + crest(m.h)
      + '<div style="min-width:0"><div style="font-weight:700;font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(H.name) + ' <span style="color:' + MUT + '">v</span> ' + esc(A.name) + '</div>'
      + '<div style="font-size:11.5px;color:' + MUT + ';margin-top:3px">' + meta + '</div></div>' + crest(m.a) + '</div>'
      + '<div style="text-align:right;flex:none;padding-left:10px">' + statusPill(st) + '<div style="font-family:' + FH + ';font-size:10px;color:' + MUT + ';font-weight:600;margin-top:4px">proj ' + Math.round(mm.xgH) + '-' + Math.round(mm.xgA) + '</div></div></div>';
    var body;
    if (opts.corners) {
      var hcl = mm.hcLine || 4.5, acl = mm.acLine || 4.5;
      body = '<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;flex-wrap:wrap"><div style="font-size:12px;color:' + MUT + '">Proj corners <span style="font-family:' + FH + ';font-weight:700;color:' + GOLD + '">' + mm.cxTot.toFixed(1) + '</span> total</div><div style="font-size:12px;color:' + MUT + '">' + esc(H.name) + ' <span style="font-family:' + FH + ';font-weight:700;color:' + TXT + '">' + (mm.cxH || 0).toFixed(1) + '</span></div><div style="font-size:12px;color:' + MUT + '">' + esc(A.name) + ' <span style="font-family:' + FH + ';font-weight:700;color:' + TXT + '">' + (mm.cxA || 0).toFixed(1) + '</span></div></div>'
        + '<div style="display:flex;flex-direction:column;gap:7px">' + oddRow('Total over 9.5 corners', mm.over95c, 'c9o' + K, mm.amC9o, cl) + oddRow('Total under 9.5 corners', mm.under95c, 'c9u' + K, mm.amC9u, cl) + '</div>'
        + '<div style="margin:12px 0 5px;font-size:11px;font-weight:700;letter-spacing:.06em;color:' + MUT2 + '">' + esc(H.name.toUpperCase()) + ' CORNERS</div><div style="display:flex;flex-direction:column;gap:7px">' + oddRow('Over ' + hcl + ' corners', mm.overHc, 'hco' + K, mm.amHCo, cl) + oddRow('Under ' + hcl + ' corners', mm.underHc, 'hcu' + K, mm.amHCu, cl) + '</div>'
        + '<div style="margin:12px 0 5px;font-size:11px;font-weight:700;letter-spacing:.06em;color:' + MUT2 + '">' + esc(A.name.toUpperCase()) + ' CORNERS</div><div style="display:flex;flex-direction:column;gap:7px">' + oddRow('Over ' + acl + ' corners', mm.overAc, 'aco' + K, mm.amACo, cl) + oddRow('Under ' + acl + ' corners', mm.underAc, 'acu' + K, mm.amACu, cl) + '</div>';
    } else {
      body = '<div style="display:flex;gap:12px;margin-bottom:13px">' + probBar(H.name, mm.pH, AC) + probBar('Draw', mm.pD, MUT3) + probBar(A.name, mm.pA, POS) + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:7px">' + oddRow(H.name + ' to win', mm.pH, '1x2h' + K, mm.amH, cl) + oddRow('Draw', mm.pD, '1x2d' + K, mm.amD, cl) + oddRow(A.name + ' to win', mm.pA, '1x2a' + K, mm.amA, cl)
        + oddRow('Over 2.5 goals', mm.over25, 'o25' + K, mm.amO25, cl) + oddRow('Under 2.5 goals', mm.under25, 'u25' + K, mm.amU25, cl) + oddRow('Both teams to score', mm.btts, 'btts' + K, mm.amBTTS, cl) + '</div>';
    }
    return '<div class="dlcard" style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:16px;padding:16px">' + head + body + '</div>';
  }
  function miniMatch(m) {
    var mm = matchModel(m), H = TEAMS[m.h], A = TEAMS[m.a], st = statusOf(m.date, m.live);
    var favHome = mm.pH >= mm.pA, favName = favHome ? H.name : A.name, favP = Math.max(mm.pH, mm.pA);
    var favMk = market(favP, (favHome ? '1x2h' : '1x2a') + idk(m), favHome ? mm.amH : mm.amA);
    return '<button class="dlcard dlbtn" data-act="tab" data-tab="matches" style="text-align:left;width:100%;background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:14px;padding:13px 14px;display:flex;flex-direction:column;gap:9px;cursor:pointer;color:' + TXT + '">'
      + '<div style="display:flex;align-items:center;justify-content:space-between">' + statusPill(st) + '<span style="font-size:11px;color:' + MUT + '">' + esc(m.stage) + '</span></div>'
      + '<div style="display:flex;align-items:center;gap:9px"><span style="font-size:20px">' + H.flag + '</span><span style="font-weight:700;font-size:15px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(H.name) + ' <span style="color:' + MUT + ';font-weight:600">v</span> ' + esc(A.name) + '</span><span style="font-size:20px">' + A.flag + '</span></div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px solid ' + LINE + '"><span style="font-size:11.5px;color:' + MUT + '">' + (mm.live ? 'Best price' : 'Model pick') + '</span>'
      + '<span style="font-size:12.5px;font-weight:600">' + esc(favName) + ' <span style="font-family:' + FH + ';color:' + AC + '">' + Math.round(favP * 100) + '%</span> \u00B7 ' + fmtAm(favMk.am) + '</span></div></div>';
  }
  function lockCard(p, rank) {
    return '<div class="dlcard" style="position:relative;background:' + INSET2 + ';border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:11px;flex:1 1 180px;min-width:0;overflow:hidden">'
      + '<div style="display:flex;align-items:center;gap:11px"><span style="font-family:' + FH + ';font-weight:700;font-size:14px;color:' + GOLD + ';flex:none">#' + rank + '</span>'
      + '<div style="width:46px;height:46px;flex:none;border-radius:50%;background:' + INSET + ';display:grid;place-items:center;font-family:' + FH + ';font-weight:700;font-size:14px;color:' + AC + '">' + esc(p.init) + '</div>'
      + '<div style="min-width:0;flex:1"><div style="font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</div><div style="font-size:12px;color:' + MUT + '">' + p.flag + ' ' + esc(p.teamName) + ' ' + (p.home ? 'vs' : '@') + ' ' + esc(p.oppName) + '</div></div></div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:11px;background:' + CARD + ';border:1px solid rgba(255,194,77,.18)">'
      + '<div><div style="font-size:10px;color:' + MUT + ';font-weight:600">GOAL CHANCE</div><div style="font-family:' + FH + ';font-weight:700;font-size:19px;color:' + GOLD + '">' + Math.round(p.prob * 100) + '%</div></div>'
      + '<div style="text-align:right"><div style="font-size:10px;color:' + MUT + ';font-weight:600">ANYTIME</div><div style="font-family:' + FH + ';font-weight:700;font-size:15px">' + fmtAm(p.am) + '</div></div></div>'
      + '<div style="font-size:11.5px;color:' + MUT2 + ';line-height:1.45">' + (p.edge >= 0 ? 'Edge +' : 'Edge ') + (p.edge * 100).toFixed(1) + 'pts vs consensus, EV ' + (p.ev > 0 ? '+' : '') + p.ev.toFixed(1) + '/$100.</div></div>';
  }
  function playerCard(p) {
    return '<div class="dlcard" style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:16px;padding:15px;display:flex;flex-direction:column;gap:12px">'
      + '<div style="display:flex;align-items:center;gap:12px"><div style="width:52px;height:52px;flex:none;border-radius:50%;background:' + INSET + ';display:grid;place-items:center;font-family:' + FH + ';font-weight:700;font-size:16px;color:' + AC + '">' + esc(p.init) + '</div>'
      + '<div style="min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-weight:700;font-size:15px">' + esc(p.name) + '</span>' + edgeBadge(p.edge) + '</div>'
      + '<div style="font-size:12px;color:' + MUT + ';margin-top:2px">' + p.flag + ' ' + esc(p.teamName) + ' ' + (p.home ? 'vs' : '@') + ' ' + esc(p.oppName) + ' \u00B7 ' + esc(p.pos) + ' \u00B7 ' + dayLabel(p.date) + '</div></div>'
      + '<div style="margin-left:auto;text-align:center"><div style="font-size:10px;color:' + MUT + ';font-weight:600">SCORE</div><div style="font-family:' + FH + ';font-weight:700;font-size:22px;color:' + scoreColor(p.score) + '">' + p.score + '</div></div></div>'
      + '<div style="display:flex;gap:8px">' + miniStat('Goal chance', pct(p.prob), TXT) + miniStat('Anytime', fmtAm(p.am), scoreColor(p.score)) + miniStat('EV /$100', (p.ev > 0 ? '+' : '') + p.ev.toFixed(1), evColor(p.ev)) + '<div style="display:flex;align-items:center">' + addBtn('gs|' + p.name + '|' + p.oppName, p.name + ' anytime', p.teamName + (p.home ? ' v ' : ' @ ') + p.oppName, p.am, p.prob) + '</div></div></div>';
  }
  function miniStat(label, val, color) { return '<div style="flex:1;background:' + INSET + ';border:1px solid ' + LINE + ';border-radius:11px;padding:8px 10px"><div style="font-size:10px;color:' + MUT + ';font-weight:600">' + label + '</div><div style="font-family:' + FH + ';font-weight:700;font-size:16px;color:' + color + '">' + val + '</div></div>'; }
  function valueRow(s) {
    return '<div class="dlrow" style="display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;background:' + CARD + ';border:1px solid ' + LINE + '">'
      + '<span style="font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.05);color:' + grpColor(s.grp) + ';flex:none">' + s.grp.toUpperCase() + '</span>'
      + '<div style="min-width:0;flex:1"><div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.label) + '</div><div style="font-size:11px;color:' + MUT + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.match) + '</div></div>'
      + '<div style="text-align:right;flex:none"><div style="font-family:' + FH + ';font-weight:700;font-size:15px;color:' + scoreColor(s.score) + '">' + fmtAm(s.am) + '</div><div style="font-family:' + FH + ';font-size:11px;color:' + POS + ';font-weight:700">EV +' + s.ev.toFixed(1) + '</div></div></div>';
  }

  // ---------------------------------------------------------------- tab bodies
  function renderToday() {
    var now = new Date();
    var todays = MATCHES.filter(function (m) { return sameDay(m.date, now); }).sort(function (a, b) { return a.date - b.date; });
    var gsAll = goalscorers(); var gsToday = gsAll.filter(function (g) { return sameDay(g.date, now); });
    var value = bestValueToday();
    var live = todays.filter(function (m) { return statusOf(m.date, m.live).key === 'live'; }).length;
    var topP = gsToday[0] || gsAll[0];
    var avgEdge = value.length ? (value.reduce(function (a, s) { return a + s.edge; }, 0) / value.length * 100) : 0;
    var locks = (gsToday.length ? gsToday : gsAll).slice(0, 3);

    var stats = '<div class="dlstats" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:26px">'
      + statCard('Matches today', todays.length, TXT, todays.length ? dayLabel(todays[0].date) + ' slate' : 'no games')
      + statCard('Live now', live, live ? NEG : TXT, live ? 'in play' : 'none live')
      + statCard('Value bets', value.length, POS, LIVE_STATE === 'ok' ? 'best price vs consensus' : 'model edges')
      + statCard('Top goal pick', topP ? Math.round(topP.prob * 100) + '%' : '\u2014', GOLD, topP ? topP.name : '')
      + statCard('Avg edge', (avgEdge > 0 ? '+' : '') + avgEdge.toFixed(1), avgEdge > 0 ? POS : MUT, 'points vs book') + '</div>';

    var locksBanner = locks.length ? '<div style="background:linear-gradient(135deg,rgba(255,194,77,.10),rgba(255,138,76,.04) 60%,transparent);border:1px solid rgba(255,194,77,.28);border-radius:18px;padding:18px;margin-bottom:8px">'
      + '<div style="display:flex;align-items:center;gap:11px;margin-bottom:14px;flex-wrap:wrap"><span style="font-family:' + FH + ';font-weight:700;font-size:11px;letter-spacing:.13em;color:' + GOLD + ';background:rgba(255,194,77,.12);border:1px solid rgba(255,194,77,.32);padding:5px 10px;border-radius:8px">\u2605 TODAY\u2019S LOCKS</span><span style="font-size:13px;color:#c3cad6;font-weight:600">If you only back three goalscorers</span></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:12px">' + locks.map(function (p, i) { return lockCard(p, i + 1); }).join('') + '</div></div>' : '';

    var todayMatches = todays.length ? '<div class="dlgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + todays.map(miniMatch).join('') + '</div>'
      : '<div style="color:' + MUT + ';font-size:13px;padding:20px;text-align:center;background:' + CARD + ';border-radius:14px;border:1px solid ' + LINE + '">No matches today \u2014 see the Matches tab for the upcoming slate.</div>';
    var valueBoard = value.length ? '<div style="display:flex;flex-direction:column;gap:8px">' + value.map(valueRow).join('') + '</div>' : '<div style="color:' + MUT + ';font-size:13px">No standout value on today\u2019s slate.</div>';
    var gsBoard = (gsToday.length ? gsToday : gsAll).slice(0, 6);
    var gsHtml = gsBoard.length ? '<div class="dlgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + gsBoard.map(playerCard).join('') + '</div>' : '<div style="color:' + MUT + ';font-size:13px">No goalscorer markets available yet.</div>';
    var dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    var sub = esc(dateStr) + ' \u00B7 World Cup 2026. ' + (LIVE_STATE === 'ok' ? 'Live OddsBlaze anytime goalscorer, match result, goals and corner edges.' : 'Anytime goalscorer, match result, goals and corner edges.');

    return pageHead('COMMAND CENTER', 'Today\u2019s best goals', sub)
      + stats + locksBanner
      + sectionHead(AC, 'Today\u2019s Matches', todays.length + ' scheduled', '<button class="dlbtn" data-act="tab" data-tab="matches" style="background:none;border:1px solid rgba(255,255,255,.12);color:' + MUT + ';font-family:' + FB + ';font-weight:600;font-size:12px;padding:6px 12px;border-radius:9px;cursor:pointer">All matches \u2192</button>') + todayMatches
      + sectionHead(POS, 'Best Value Today', 'ranked by EV') + valueBoard
      + sectionHead(GOLD, 'Top Goalscorers', LIVE_STATE === 'ok' ? 'best price vs consensus' : 'model vs book', '<button class="dlbtn" data-act="tab" data-tab="radar" style="background:none;border:1px solid rgba(255,255,255,.12);color:' + MUT + ';font-family:' + FB + ';font-weight:600;font-size:12px;padding:6px 12px;border-radius:9px;cursor:pointer">Full radar \u2192</button>') + gsHtml;
  }
  function dateChips() {
    var days = []; MATCHES.slice().sort(function (a, b) { return a.date - b.date; }).forEach(function (m) { var k = dayKey(m.date); if (!days.some(function (d) { return d.k === k; })) days.push({ k: k, date: m.date }); });
    var chip = function (k, label, on) { return '<button class="dlbtn" data-act="date" data-date="' + k + '" style="padding:6px 13px;border-radius:20px;font-family:' + FB + ';font-weight:700;font-size:12px;cursor:pointer;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (on ? AC : CARD) + ';color:' + (on ? '#0a0c11' : MUT) + '">' + label + '</button>'; };
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' + chip('all', 'All days', state.dateFilter === 'all') + days.map(function (d) { return chip(d.k, dayLabel(d.date) + ' ' + d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), state.dateFilter === d.k); }).join('') + '</div>';
  }
  function renderMatches(corners) {
    var list = MATCHES.slice().sort(function (a, b) { return a.date - b.date; });
    if (state.dateFilter !== 'all') list = list.filter(function (m) { return dayKey(m.date) === state.dateFilter; });
    var groups = []; list.forEach(function (m) { var k = dayKey(m.date); var g = groups.filter(function (x) { return x.k === k; })[0]; if (!g) { g = { k: k, date: m.date, items: [] }; groups.push(g); } g.items.push(m); });
    var html = pageHead(corners ? 'SET-PIECE LAB' : 'MATCH CENTER', corners ? 'Corner edges' : 'Match markets', corners ? 'Projected corner volume and over/under lines across the knockout slate.' : 'Result (1X2), over/under 2.5 goals and both-teams-to-score across the slate.') + dateChips();
    if (!groups.length) return html + '<div style="color:' + MUT + ';font-size:13px;margin-top:14px">No matches for that day.</div>';
    groups.forEach(function (g) {
      html += '<div style="display:flex;align-items:center;gap:10px;margin:20px 0 12px"><span style="font-family:' + FH + ';font-weight:700;font-size:14px">' + dayLabel(g.date) + '</span><span style="font-size:12px;color:' + MUT + '">' + g.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '</span><span style="flex:1;height:1px;background:' + LINE + '"></span></div>'
        + '<div class="dlgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">' + g.items.map(function (m) { return matchCardFull(m, { corners: corners }); }).join('') + '</div>';
    });
    return html;
  }
  function renderRadar() {
    var all = goalscorers();
    var teams = Object.keys(TEAMS).filter(function (t) { return all.some(function (p) { return p.team === t; }); }).sort();
    var chip = function (t, label, on) { return '<button class="dlbtn" data-act="team" data-team="' + t + '" style="padding:6px 12px;border-radius:20px;font-family:' + FB + ';font-weight:700;font-size:12px;cursor:pointer;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.1)') + ';background:' + (on ? AC : CARD) + ';color:' + (on ? '#0a0c11' : MUT) + '">' + label + '</button>'; };
    var chips = chip('', 'All teams', state.teamFilter === '') + teams.map(function (t) { return chip(t, TEAMS[t].flag + ' ' + t, state.teamFilter === t); }).join('');
    var list = state.teamFilter ? all.filter(function (p) { return p.team === state.teamFilter; }) : all;
    var top = list.filter(function (p) { return p.score >= 68; }).slice(0, 4);
    var strip = top.length ? '<div style="background:linear-gradient(135deg,rgba(255,194,77,.10),rgba(255,138,76,.04) 60%,transparent);border:1px solid rgba(255,194,77,.28);border-radius:18px;padding:16px;margin-bottom:16px">'
      + '<div style="font-family:' + FH + ';font-weight:700;font-size:11px;letter-spacing:.13em;color:' + GOLD + ';margin-bottom:12px">\u2605 TOP VALUE PICKS</div>'
      + '<div class="dlgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">'
      + top.map(function (p) { return '<div style="background:' + INSET2 + ';border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:11px 12px"><div style="font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</div><div style="font-size:11.5px;color:' + MUT + ';margin:3px 0">Anytime ' + fmtAm(p.am) + ' \u00B7 ' + pct(p.prob) + '</div><div style="font-family:' + FH + ';font-weight:700;font-size:18px;color:' + POS + '">' + p.score + '</div></div>'; }).join('') + '</div></div>' : '';
    return pageHead('GOALSCORER RADAR', 'Anytime goalscorer edges', 'Every attacker priced by the market \u2014 the home-run analog for soccer.')
      + strip + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 16px">' + chips + '</div>'
      + (list.length ? '<div class="dlgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + list.map(playerCard).join('') + '</div>' : '<div style="color:' + MUT + ';font-size:13px">No goalscorer markets available yet \u2014 they populate closer to kickoff.</div>');
  }
  function arbRow(a) {
    var stakes = a.legs.map(function (l) { return { n: l.n, am: l.am, w: impliedProb(l.am) / a.sum }; });
    return '<div style="background:' + CARD + ';border:1px solid rgba(53,208,192,.30);border-radius:14px;padding:14px 15px">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap"><span style="font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(53,208,192,.16);color:' + POS + '">ARB ' + a.roi.toFixed(2) + '%</span><span style="font-weight:700;font-size:14px">' + esc(a.match) + '</span><span style="font-size:12px;color:' + MUT + '">' + esc(a.type) + '</span>' + (a.live ? '<span class="dlpulse" style="width:7px;height:7px;border-radius:50%;background:' + NEG + '"></span>' : '') + '<span style="margin-left:auto;font-family:' + FH + ';font-weight:700;font-size:13px;color:' + POS + '">+' + a.roi.toFixed(2) + '% guaranteed</span></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + stakes.map(function (l) { return '<div style="flex:1;min-width:120px;background:' + INSET + ';border:1px solid ' + LINE + ';border-radius:10px;padding:8px 10px"><div style="font-size:11px;color:' + MUT + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.n) + '</div><div style="font-family:' + FH + ';font-weight:700;font-size:15px">' + fmtAm(l.am) + '</div><div style="font-size:11px;color:' + POS + ';font-weight:700">stake ' + (l.w * 100).toFixed(1) + '%</div></div>'; }).join('') + '</div></div>';
  }
  function scanRow(s2) {
    var d = s2.date ? ' \u00B7 ' + dayLabel(s2.date) : '';
    return '<div class="dlrow" style="display:flex;align-items:center;gap:12px;padding:10px 13px;border-radius:11px;background:' + CARD + ';border:1px solid ' + LINE + '">'
      + '<span style="font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.05);color:' + grpColor(s2.grp) + ';flex:none">' + s2.grp.toUpperCase() + '</span>'
      + '<div style="min-width:0;flex:1"><div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s2.label) + '</div><div style="font-size:11px;color:' + MUT + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s2.match) + esc(d) + '</div></div>'
      + '<div style="text-align:right;flex:none"><div style="font-family:' + FH + ';font-weight:700;font-size:15px">' + fmtAm(s2.am) + '</div><div style="font-size:10.5px;color:' + MUT + '">fair ' + pct(s2.prob) + '</div></div>'
      + '<div style="text-align:right;flex:none;min-width:58px"><div style="font-family:' + FH + ';font-weight:700;font-size:14px;color:' + evColor(s2.ev) + '">' + (s2.ev > 0 ? '+' : '') + s2.ev.toFixed(1) + '</div><div style="font-size:10px;color:' + MUT + '">EV/100</div></div>' + edgeBadge(s2.edge) + addBtn(s2.grp + '|' + s2.match + '|' + s2.label, s2.label, s2.match, s2.am, s2.prob) + '</div>';
  }
  function renderScanner() {
    var all = scanAll().filter(function (s2) { return isFinite(s2.ev); }).sort(function (a, b) { return b.ev - a.ev; });
    var value = all.filter(function (s2) { return s2.edge > (LIVE ? 0.005 : 0.02); }).slice(0, 25);
    var fades = all.filter(function (s2) { return s2.edge < -0.05; }).sort(function (a, b) { return a.ev - b.ev; }).slice(0, 6);
    var arbs = findArbs();
    var bestEv = value.length ? value[0].ev : 0;
    var stats = '<div class="dlstats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">'
      + statCard('Markets scanned', all.length, TXT, MATCHES.length + ' matches')
      + statCard('Value bets', value.length, POS, LIVE_STATE === 'ok' ? 'best price vs consensus' : 'model edges')
      + statCard('Arbitrage', arbs.length, arbs.length ? POS : MUT, arbs.length ? 'guaranteed profit' : 'none right now')
      + statCard('Top EV', (bestEv > 0 ? '+' : '') + bestEv.toFixed(1), bestEv > 0 ? POS : MUT, 'per $100') + '</div>';
    var arbNote = LIVE_STATE === 'ok' ? '' : '<div style="color:' + MUT + ';font-size:12.5px;background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:10px;padding:11px 13px">Arbitrage needs live prices from multiple books \u2014 connect the OddsBlaze proxy to surface guaranteed-profit combos. (None in model mode.)</div>';
    var arbBoard = arbs.length ? '<div style="display:flex;flex-direction:column;gap:10px">' + arbs.map(arbRow).join('') + '</div>' : arbNote;
    var valueBoard = value.length ? '<div style="display:flex;flex-direction:column;gap:7px">' + value.map(scanRow).join('') + '</div>' : '<div style="color:' + MUT + ';font-size:13px">No positive-edge markets on the current slate.</div>';
    var fadeBoard = fades.length ? '<div style="display:flex;flex-direction:column;gap:7px">' + fades.map(scanRow).join('') + '</div>' : '';
    return pageHead('EDGE SCANNER', 'Value & arbitrage', (LIVE_STATE === 'ok' ? 'Live OddsBlaze prices across all books. ' : 'Model prices (connect proxy for live arbitrage). ') + 'Every market ranked by expected value; guaranteed-profit combos flagged.')
      + stats
      + sectionHead(POS, 'Arbitrage Opportunities', arbs.length ? arbs.length + ' found' : 'scanning all books') + arbBoard
      + sectionHead(AC, 'Top Value Bets', 'ranked by EV per $100') + valueBoard
      + (fadeBoard ? sectionHead(NEG, 'Overpriced (Fade)', 'negative edge') + fadeBoard : '');
  }
  // ---------------------------------------------------------------- bet slip + line shop
  var BOOK_LABELS = { draftkings: 'DK', fanatics: 'FAN', betmgm: 'MGM', caesars: 'CZR' };
  function decFromAm(am) { am = Number(am); if (!isFinite(am) || am === 0) return 1; return am > 0 ? am / 100 + 1 : 100 / (-am) + 1; }
  function amFromDec(d) { return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); }
  function loadSlip() { try { var r = localStorage.getItem('dl_slip'); state.slip = r ? JSON.parse(r) : []; } catch (e) { state.slip = []; } if (!Array.isArray(state.slip)) state.slip = []; }
  function saveSlip() { try { localStorage.setItem('dl_slip', JSON.stringify(state.slip)); } catch (e) {} }
  function inSlip(pid) { return (state.slip || []).some(function (p) { return p.pid === pid; }); }
  function togglePick(pick) { var i = -1; (state.slip || []).forEach(function (p, ix) { if (p.pid === pick.pid) i = ix; }); if (i >= 0) state.slip.splice(i, 1); else state.slip.push(pick); saveSlip(); }
  function addBtn(pid, label, match, am, prob) {
    if (am == null || !isFinite(am) || am === 0) return '';
    var on = inSlip(pid);
    return '<button class="dlbtn" data-act="add" data-pid="' + esc(pid) + '" data-label="' + esc(encodeURIComponent(label)) + '" data-match="' + esc(encodeURIComponent(match || '')) + '" data-am="' + am + '" data-prob="' + (prob || 0) + '" title="' + (on ? 'Remove from slip' : 'Add to bet slip') + '" style="flex:none;margin-left:8px;width:26px;height:26px;border-radius:8px;border:1px solid ' + (on ? AC : 'rgba(255,255,255,.16)') + ';background:' + (on ? AC : 'transparent') + ';color:' + (on ? '#0a0c11' : MUT) + ';font-weight:800;font-size:15px;line-height:1;cursor:pointer">' + (on ? '\u2713' : '+') + '</button>';
  }
  function bookCells(books) {
    if (!books) return BOOKS.map(function () { return '<td style="text-align:center;color:' + MUT + ';padding:5px 7px">\u2014</td>'; }).join('');
    var best = null; BOOKS.forEach(function (b) { var a = books[b]; if (a != null && (best == null || betterAm(a, best))) best = a; });
    return BOOKS.map(function (b) { var a = books[b]; if (a == null) return '<td style="text-align:center;color:' + MUT + ';padding:5px 7px">\u2014</td>'; var isBest = a === best; return '<td style="text-align:center;padding:5px 7px"><span style="font-family:' + FH + ';font-weight:700;font-size:13px;padding:2px 8px;border-radius:6px;' + (isBest ? 'background:rgba(53,208,192,.16);color:' + POS : 'color:' + TXT) + '">' + fmtAm(a) + '</span></td>'; }).join('');
  }
  function shopRow(label, books) { return '<tr style="border-top:1px solid ' + LINE + '"><td style="padding:6px 8px;font-size:12.5px;font-weight:600;white-space:nowrap">' + esc(label) + '</td>' + bookCells(books) + '</tr>'; }
  function renderLineShop() {
    if (LIVE_STATE !== 'ok') return pageHead('LINE SHOP', 'Compare every book', 'Side-by-side prices across DraftKings, Fanatics, BetMGM & Caesars \u2014 best price highlighted.') + '<div style="color:' + MUT + ';font-size:13px;background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:12px;padding:16px">Line shopping needs live OddsBlaze prices from multiple books. Connect the proxy (or wait for the next sync) to compare books side by side. Currently in model-only mode.</div>';
    var head = '<thead><tr><th style="text-align:left;padding:6px 8px;font-size:11px;color:' + MUT + ';font-weight:700">MARKET</th>' + BOOKS.map(function (b) { return '<th style="text-align:center;padding:6px 8px;font-size:11px;color:' + MUT + ';font-weight:700">' + (BOOK_LABELS[b] || b.toUpperCase()) + '</th>'; }).join('') + '</tr></thead>';
    var cards = MATCHES.map(function (m) {
      var o = (LIVE && LIVE.mk) ? LIVE.mk[m.id] : null; if (!o) return ''; var H = TEAMS[m.h], A = TEAMS[m.a];
      var rows = shopRow(H.name + ' win', o.bkH) + shopRow('Draw', o.bkD) + shopRow(A.name + ' win', o.bkA) + shopRow('Over 2.5 goals', o.bkO25) + shopRow('Under 2.5 goals', o.bkU25) + shopRow('Both to score', o.bkBTTS) + shopRow('Over 9.5 corners', o.bkC9o) + shopRow('Under 9.5 corners', o.bkC9u) + ((o.bkHCo || o.bkHCu) ? shopRow(H.name + ' corners o' + (o.hcLine || 4.5), o.bkHCo) + shopRow(H.name + ' corners u' + (o.hcLine || 4.5), o.bkHCu) : '') + ((o.bkACo || o.bkACu) ? shopRow(A.name + ' corners o' + (o.acLine || 4.5), o.bkACo) + shopRow(A.name + ' corners u' + (o.acLine || 4.5), o.bkACu) : '');
      return '<div class="dlcard" style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:14px;padding:14px 15px;margin-bottom:12px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:8px"><span style="font-size:18px">' + H.flag + '</span><span style="font-weight:700;font-size:14.5px">' + esc(H.name) + ' v ' + esc(A.name) + '</span><span style="font-size:18px">' + A.flag + '</span><span style="margin-left:auto;font-size:11.5px;color:' + MUT + '">' + dayLabel(m.date) + ' ' + fmtTime(m.date) + '</span></div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' + head + '<tbody>' + rows + '</tbody></table></div></div>';
    }).join('');
    return pageHead('LINE SHOP', 'Compare every book', 'Best price per market highlighted in teal across DraftKings, Fanatics, BetMGM & Caesars.') + (cards || '<div style="color:' + MUT + '">No live markets to compare yet.</div>');
  }
  function slipUI() {
    var slip = state.slip || [], cnt = slip.length, stake = state.stake || 25;
    var dec = slip.reduce(function (a, p) { return a * decFromAm(p.am); }, 1);
    var parlayAm = cnt ? amFromDec(dec) : 0, payout = stake * dec;
    var fairP = slip.reduce(function (a, p) { return a * (p.prob || 0); }, 1);
    var parlayEv = cnt ? (fairP * dec - 1) * 100 : 0;
    var byMatch = {}; slip.forEach(function (p) { var k = p.match || ''; byMatch[k] = (byMatch[k] || 0) + 1; });
    var corr = Object.keys(byMatch).some(function (k) { return k && byMatch[k] > 1; });
    var fab = '<button class="dlbtn" data-act="toggleslip" style="position:fixed;right:20px;bottom:20px;z-index:100003;display:flex;align-items:center;gap:9px;padding:12px 18px;border:none;border-radius:30px;cursor:pointer;font-family:' + FB + ';font-weight:700;font-size:14px;color:#0a0c11;background:linear-gradient(135deg,' + AC + ',' + PINK + ');box-shadow:0 8px 24px rgba(255,77,125,.4)">\uD83E\uDDFE Bet Slip' + (cnt ? ' <span style="background:#0a0c11;color:' + AC + ';border-radius:20px;padding:1px 8px;font-size:12px">' + cnt + '</span>' : '') + '</button>';
    if (!state.slipOpen) return fab;
    var rows = slip.map(function (p) { return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ' + LINE + '"><div style="min-width:0;flex:1"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.label) + '</div><div style="font-size:11px;color:' + MUT + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.match || '') + '</div></div><span style="font-family:' + FH + ';font-weight:700;font-size:14px">' + fmtAm(p.am) + '</span><button class="dlbtn" data-act="rmpick" data-pid="' + esc(p.pid) + '" style="flex:none;width:24px;height:24px;border-radius:7px;border:1px solid rgba(255,107,107,.3);background:transparent;color:' + NEG + ';font-weight:800;cursor:pointer">\u00d7</button></div>'; }).join('');
    var chips = [10, 25, 50, 100].map(function (v) { var on = stake === v; return '<button class="dlbtn" data-act="stake" data-stake="' + v + '" style="flex:1;padding:7px;border-radius:8px;border:1px solid ' + (on ? 'transparent' : 'rgba(255,255,255,.12)') + ';background:' + (on ? AC : CARD) + ';color:' + (on ? '#0a0c11' : MUT) + ';font-weight:700;font-size:12.5px;cursor:pointer">$' + v + '</button>'; }).join('');
    var summary = '<div style="margin-top:12px;background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:12px;padding:12px">'
      + '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span style="color:' + MUT + '">' + (cnt > 1 ? 'Parlay odds' : 'Odds') + '</span><span style="font-family:' + FH + ';font-weight:700">' + fmtAm(parlayAm) + ' <span style="color:' + MUT + ';font-weight:500">(' + dec.toFixed(2) + 'x)</span></span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span style="color:' + MUT + '">To win</span><span style="font-family:' + FH + ';font-weight:700;color:' + POS + '">$' + (payout - stake).toFixed(2) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:13px;padding-top:6px;border-top:1px solid ' + LINE + '"><span style="color:' + MUT + '">Payout</span><span style="font-family:' + FH + ';font-weight:700;font-size:15px">$' + payout.toFixed(2) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:8px"><span style="color:' + MUT + '">Model EV</span><span style="font-family:' + FH + ';font-weight:700;color:' + evColor(parlayEv) + '">' + (parlayEv > 0 ? '+' : '') + parlayEv.toFixed(1) + '% \u00B7 ' + pct(fairP) + ' fair</span></div></div>';
    var drawer = '<div style="position:fixed;right:20px;bottom:80px;z-index:100003;width:340px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);overflow:auto;background:' + INSET2 + ';border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);padding:16px">'
      + '<div style="display:flex;align-items:center;margin-bottom:6px"><span style="font-family:' + FH + ';font-weight:700;font-size:16px">Bet Slip</span><span style="font-size:12px;color:' + MUT + ';margin-left:8px">' + cnt + ' leg' + (cnt === 1 ? '' : 's') + '</span>' + (cnt ? '<button class="dlbtn" data-act="clearslip" style="margin-left:auto;background:none;border:none;color:' + MUT + ';font-size:12px;cursor:pointer;text-decoration:underline">Clear</button>' : '') + '</div>'
      + (cnt ? rows + (corr ? '<div style="margin-top:10px;font-size:11.5px;color:' + GOLD + ';background:rgba(255,194,77,.1);border:1px solid rgba(255,194,77,.28);border-radius:9px;padding:8px 10px">\u26a0 Correlated legs (same match). Many books restrict or void same-game parlays.</div>' : '')
        + '<div style="margin-top:12px;display:flex;gap:6px">' + chips + '</div>' + summary
        + '<div style="margin-top:8px;font-size:10.5px;color:' + MUT + '">For entertainment only. EV uses de-vigged fair probabilities and assumes independent legs.</div>'
        : '<div style="color:' + MUT + ';font-size:13px;padding:14px 0">Your slip is empty. Tap <b style="color:' + AC + '">+</b> on any market to add a pick.</div>') + '</div>';
    return fab + drawer;
  }
  function body() { if (state.tab === 'today') return renderToday(); if (state.tab === 'scanner') return renderScanner(); if (state.tab === 'lineshop') return renderLineShop(); if (state.tab === 'radar') return renderRadar(); if (state.tab === 'matches') return renderMatches(false); if (state.tab === 'corners') return renderMatches(true); return ''; }

  // ---------------------------------------------------------------- shell (MLB layout)
  var NAV = [['today', '\u26A1', 'Today'], ['scanner', '\uD83D\uDD0D', 'Edge Scanner'], ['lineshop', '\uD83D\uDCB0', 'Line Shop'], ['radar', '\uD83C\uDFAF', 'Goalscorer Radar'], ['matches', '\u26BD', 'Matches'], ['corners', '\uD83D\uDEA9', 'Corners']];
  var state = { tab: 'today', teamFilter: '', dateFilter: 'all', slip: [], slipOpen: false, stake: 25 };
  var overlay = null, headerSwitcher = null, tickTimer = null, liveTimer = null;
  function safeRender() { try { if (overlay && overlay.style.display !== 'none') render(); } catch (e) {} }

  function railBtn(id, icon, label) {
    var on = state.tab === id;
    return '<button class="dlnav" data-act="tab" data-tab="' + id + '" style="display:flex;align-items:center;gap:11px;padding:10px 11px;border:none;border-radius:10px;cursor:pointer;text-align:left;font-family:' + FB + ';font-weight:600;font-size:13.5px;background:' + (on ? 'rgba(255,138,76,.12)' : 'transparent') + ';color:' + (on ? TXT : MUT3) + ';position:relative">'
      + '<span style="position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:18px;border-radius:3px;background:' + (on ? AC : 'transparent') + '"></span>'
      + '<span style="font-size:16px;width:18px;text-align:center">' + icon + '</span><span>' + label + '</span></button>';
  }
  function bottomBtn(id, icon, label) {
    var on = state.tab === id;
    return '<button class="dlbtn" data-act="tab" data-tab="' + id + '" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;border:none;background:none;cursor:pointer;font-family:' + FB + ';font-weight:600;font-size:10.5px;color:' + (on ? AC : MUT) + '"><span style="font-size:17px">' + icon + '</span>' + label.split(' ')[0] + '</button>';
  }

  function render() {
    if (!overlay) return;
    var now = new Date();
    var todayCount = MATCHES.filter(function (m) { return sameDay(m.date, now); }).length;
    var liveCount = MATCHES.filter(function (m) { return statusOf(m.date, m.live).key === 'live'; }).length;
    var valueCount = bestValueToday().length;
    var ver = appVersion();
    var dateShort = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    var liveMode = LIVE_STATE === 'ok';
    var isNeg = !!liveCount;
    var pillTxt = isNeg ? (liveCount + ' live now') : liveMode ? 'LIVE \u00B7 OddsBlaze' : LIVE_STATE === 'loading' ? 'Syncing odds\u2026' : 'Model \u00B7 sample slate';
    var pillCol = isNeg ? NEG : liveMode ? POS : LIVE_STATE === 'loading' ? GOLD : MUT;
    var pillBg = isNeg ? 'rgba(255,107,107,.1)' : liveMode ? 'rgba(53,208,192,.08)' : LIVE_STATE === 'loading' ? 'rgba(255,194,77,.08)' : 'rgba(255,255,255,.04)';
    var pillBd = isNeg ? 'rgba(255,107,107,.3)' : liveMode ? 'rgba(53,208,192,.22)' : LIVE_STATE === 'loading' ? 'rgba(255,194,77,.25)' : LINE;
    var pillPulse = isNeg || LIVE_STATE === 'loading';

    var header = '<header style="position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:16px;padding:14px 22px;background:rgba(10,12,17,.8);backdrop-filter:blur(14px);border-bottom:1px solid ' + LINE + '">'
      + '<div style="display:flex;align-items:center;gap:11px"><div style="width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:19px;background:linear-gradient(150deg,' + AC + ',' + PINK + ');box-shadow:0 6px 20px rgba(255,77,125,.35)">\u26BD</div>'
      + '<div style="line-height:1"><div style="font-family:' + FH + ';font-weight:700;font-size:19px;letter-spacing:-.02em">Dinger<span style="color:' + AC + '">Lab</span></div><div style="font-size:11px;color:' + MUT + ';letter-spacing:.04em;margin-top:2px">WORLD CUP 2026 \u00B7 SOCCER</div></div></div>'
      + '<div class="dlhide" style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:10px;background:' + CARD + ';border:1px solid ' + LINE + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="' + MUT3 + '" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span style="font-size:13px;font-weight:600">' + dateShort + '</span><span style="font-size:12px;color:' + MUT + '">\u00B7 ' + todayCount + ' games</span></div>'
      + '<div class="dlhide" style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:10px;background:' + pillBg + ';border:1px solid ' + pillBd + '"><span class="' + (pillPulse ? 'dlpulse' : '') + '" style="width:7px;height:7px;border-radius:50%;background:' + pillCol + '"></span><span style="font-size:12.5px;font-weight:600;color:' + pillCol + '">' + pillTxt + '</span></div>'
      + '<div style="flex:1"></div>'
      + switcher('soccer')
      + (ver ? '<div class="dlhide" style="display:flex;align-items:center;gap:8px;padding:7px 11px;border-radius:10px;background:' + CARD + ';border:1px solid ' + LINE + ';font-size:12px;color:' + MUT + '">' + esc(ver) + '</div>' : '') + '</header>';

    var rail = '<nav class="dlrail" style="padding:18px 12px;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:3px;position:sticky;top:67px;align-self:start">'
      + '<div style="font-size:10.5px;letter-spacing:.12em;color:#5f6878;font-weight:700;padding:4px 10px 8px">NAVIGATE</div>'
      + NAV.map(function (n) { return railBtn(n[0], n[1], n[2]); }).join('')
      + '<div style="margin-top:14px;padding:12px;border-radius:12px;background:linear-gradient(160deg,rgba(255,138,76,.12),rgba(255,77,125,.08));border:1px solid rgba(255,138,76,.18)"><div style="font-size:11px;color:' + MUT3 + ';font-weight:600">Value bets today</div><div style="font-family:' + FH + ';font-size:22px;font-weight:700;margin-top:3px">' + valueCount + ' <span style="font-size:12px;color:' + MUT + ';font-weight:500">edges</span></div><div style="height:6px;border-radius:6px;background:rgba(255,255,255,.08);margin-top:8px;overflow:hidden"><div style="width:' + clamp(valueCount * 12, 6, 100) + '%;height:100%;background:' + AC + '"></div></div></div>'
      + '<div style="margin-top:14px;padding:4px 10px;font-size:11px;color:' + MUT + '">Switch sport</div><div style="padding:0 6px">' + switcher('soccer') + '</div></nav>';

    var note = LIVE_STATE === 'ok'
      ? 'Live odds via OddsBlaze (league <code>' + esc(LIVE_LEAGUE) + '</code>) across DraftKings, Fanatics, BetMGM & Caesars \u2014 best available price shown, fair win probability de-vigged from the market. For entertainment only.'
      : (LIVE_STATE === 'loading' ? 'Syncing live OddsBlaze odds\u2026 showing a real Round of 16 sample slate with model prices until they arrive. For entertainment only.'
        : 'Live OddsBlaze odds are unavailable right now (proxy unreachable) \u2014 showing a real Round of 16 sample slate priced by the internal model. For entertainment only.');
    var main = '<main style="padding:22px 26px 60px;min-width:0;overflow:auto">' + body()
      + '<div style="margin-top:30px;padding-top:16px;border-top:1px solid ' + LINE + ';font-size:11.5px;color:' + MUT + ';line-height:1.6">' + note + '</div></main>';

    var bottomNav = '<div class="dlbottom" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:100002;background:rgba(10,12,17,.96);backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,.08);padding:6px 6px">' + NAV.map(function (n) { return bottomBtn(n[0], n[1], n[2]); }).join('') + '</div>';

    overlay.innerHTML = '<style>'
      + '#dl-soccer-overlay *{box-sizing:border-box}'
      + '#dl-soccer-overlay ::-webkit-scrollbar{width:10px;height:10px}#dl-soccer-overlay ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:20px;border:2px solid #0a0c11}#dl-soccer-overlay ::-webkit-scrollbar-thumb:hover{background:rgba(255,138,76,.5)}'
      + '@keyframes dlpulse{0%,100%{opacity:1}50%{opacity:.35}}@keyframes dlrise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.dlpulse{animation:dlpulse 1.6s infinite}'
      + '.dlcard{transition:transform .15s,border-color .15s}.dlcard:hover{border-color:rgba(255,138,76,.45);transform:translateY(-2px)}'
      + '.dlbtn{transition:filter .12s,background .12s,color .12s}.dlbtn:hover{filter:brightness(1.12)}'
      + '.dlnav{transition:background .14s,color .14s}.dlnav:hover{background:rgba(255,255,255,.05);color:' + TXT + '}'
      + '.dlrow{transition:border-color .12s}.dlrow:hover{border-color:rgba(255,138,76,.32)}'
      + '@media(max-width:1100px){.dlstats{grid-template-columns:repeat(3,1fr)!important}}'
      + '@media(max-width:760px){.dlrail{display:none!important}.dlbottom{display:flex!important}.dlhide{display:none!important}#dl-soccer-shell{grid-template-columns:1fr!important}#dl-soccer-overlay main{padding:16px 14px 92px!important}#dl-soccer-overlay h1{font-size:23px!important}.dlstats{grid-template-columns:1fr 1fr!important}.dlgrid{grid-template-columns:1fr!important}}'
      + '</style>'
      + '<div style="min-height:100vh;background:radial-gradient(1200px 600px at 78% -8%,rgba(255,138,76,.10),transparent 60%),radial-gradient(900px 500px at 6% 4%,rgba(53,208,192,.07),transparent 55%),' + BG + ';display:flex;flex-direction:column">'
      + header
      + '<div id="dl-soccer-shell" style="display:grid;grid-template-columns:208px minmax(0,1fr);gap:0;flex:1;min-height:0">' + rail + main + '</div></div>' + bottomNav + slipUI();
  }

  function setSport(s) {
    try { localStorage.setItem('dl_sport', s); } catch (e) {}
    if (s === 'soccer') {
      if (!overlay) buildOverlay();
      overlay.style.display = 'block'; document.body.style.overflow = 'hidden'; render(); overlay.scrollTop = 0;
      if (LIVE_STATE === 'idle' || LIVE_STATE === 'fail') loadLive();
      if (!tickTimer) tickTimer = setInterval(function () { if (overlay && overlay.style.display !== 'none') render(); }, 60000);
      if (!liveTimer) liveTimer = setInterval(function () { if (overlay && overlay.style.display !== 'none') loadLive(true); }, 120000);
    } else {
      if (overlay) overlay.style.display = 'none'; document.body.style.overflow = '';
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    }
    updateHeaderSwitcher(s);
  }
  function buildOverlay() {
    overlay = document.createElement('div'); overlay.id = 'dl-soccer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;overflow-y:auto;background:' + BG + ';color:' + TXT + ';font-family:' + FB + ';display:none';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el) return; var act = el.getAttribute('data-act');
      if (act === 'sport') setSport(el.getAttribute('data-sport'));
      else if (act === 'tab') { state.tab = el.getAttribute('data-tab'); render(); overlay.scrollTop = 0; }
      else if (act === 'team') { state.teamFilter = el.getAttribute('data-team'); render(); }
      else if (act === 'date') { state.dateFilter = el.getAttribute('data-date'); render(); }
      else if (act === 'add') { togglePick({ pid: el.getAttribute('data-pid'), label: decodeURIComponent(el.getAttribute('data-label')), match: decodeURIComponent(el.getAttribute('data-match') || ''), am: parseInt(el.getAttribute('data-am'), 10), prob: parseFloat(el.getAttribute('data-prob')) || 0 }); render(); }
      else if (act === 'rmpick') { var pid = el.getAttribute('data-pid'); state.slip = state.slip.filter(function (p) { return p.pid !== pid; }); saveSlip(); render(); }
      else if (act === 'clearslip') { state.slip = []; saveSlip(); render(); }
      else if (act === 'toggleslip') { state.slipOpen = !state.slipOpen; render(); }
      else if (act === 'stake') { state.stake = parseInt(el.getAttribute('data-stake'), 10) || 25; render(); }
    });
  }
  function updateHeaderSwitcher(active) { if (headerSwitcher) headerSwitcher.innerHTML = switcher(active); }
  function injectHeaderSwitcher() {
    if (headerSwitcher) return true;
    var header = document.querySelector('header[data-hdr]'); if (!header) return false;
    headerSwitcher = document.createElement('div'); headerSwitcher.id = 'dl-sport-switch'; headerSwitcher.style.cssText = 'display:flex;align-items:center;margin-left:2px';
    headerSwitcher.innerHTML = switcher(currentSport());
    headerSwitcher.addEventListener('click', function (e) { var el = e.target.closest('[data-act="sport"]'); if (el) setSport(el.getAttribute('data-sport')); });
    if (header.children.length > 1) header.insertBefore(headerSwitcher, header.children[1]); else header.appendChild(headerSwitcher);
    return true;
  }
  function currentSport() { try { return localStorage.getItem('dl_sport') || 'mlb'; } catch (e) { return 'mlb'; } }
  loadSlip();
  function init() {
    var tries = 0; var iv = setInterval(function () { tries++; if (injectHeaderSwitcher() || tries > 60) clearInterval(iv); }, 250);
    setTimeout(function () {
      if (!headerSwitcher && !document.getElementById('dl-sport-float')) {
        var f = document.createElement('div'); f.id = 'dl-sport-float'; f.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100001';
        f.innerHTML = switcher(currentSport()); f.addEventListener('click', function (e) { var el = e.target.closest('[data-act="sport"]'); if (el) setSport(el.getAttribute('data-sport')); });
        document.body.appendChild(f); headerSwitcher = f;
      }
    }, 4000);
    if (currentSport() === 'soccer') setSport('soccer');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
