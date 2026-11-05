// 유림 가계부 위젯 (Scriptable 용)
// ─────────────────────────────────────────────────────────────
// 1) 이 코드를 Scriptable 의 새 스크립트에 붙여넣고 ▶ 실행
// 2) 가계부 앱(동기화 화면)에서 만든 "연결 코드"를 붙여넣기
// 3) 홈 화면 또는 잠금 화면에 Scriptable 위젯을 추가하고 이 스크립트 선택
//    · 위젯 편집의 Parameter 에 가계부 이름을 쓰면 그 가계부를 보여줘요 (비우면 기본 가계부)
// 연결 코드는 아이폰 키체인에만 저장되고, 이 코드로는 읽기와 기록만 할 수 있어요.
// ─────────────────────────────────────────────────────────────
const APP_URL = 'https://yurim1214.github.io/yurim-budget/';
const KC_KEY = 'yurim_budget_code';

/* ==CALC== 앱과 같은 계산 규칙 */
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function dayMatch(sd, d) { const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return d.getDate() === Math.min(sd, last); }
function occurs(t, key) {
  if (!t.rec) return t.date === key;
  const r = t.rec;
  if (key < t.date) return false;
  if (r.end && key > r.end) return false;
  if (r.skip && r.skip.includes(key)) return false;
  const s = pd(t.date), d = pd(key), w = d.getDay();
  switch (r.f) {
    case 'daily': return true;
    case 'weekdays': return w > 0 && w < 6;
    case 'weekends': return w === 0 || w === 6;
    case 'weekly': return w === s.getDay();
    case 'biweekly': return Math.round((d - s) / 864e5) % 14 === 0;
    case 'monthEnd': return addDays(d, 1).getDate() === 1;
    case 'yearly': return d.getMonth() === s.getMonth() && dayMatch(s.getDate(), d);
    default: {
      const n = { monthly: 1, m2: 2, m3: 3, m6: 6 }[r.f] || 1;
      const md = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
      return md % n === 0 && dayMatch(s.getDate(), d);
    }
  }
}
function countOcc(t, until) {
  if (!t.rec) return t.date <= until ? 1 : 0;
  const b = t.rec.end && t.rec.end < until ? t.rec.end : until; let n = 0;
  for (let d = pd(t.date); ; d = addDays(d, 1)) { const k = ymd(d); if (k > b) break; if (occurs(t, k)) n++; }
  return n;
}
function compute(items, now) {
  const by = k => items.filter(x => x.k === k).map(x => x.d);
  const meta = Object.assign({ name: '가계부', currency: 'KRW', startDay: 1 }, by('meta')[0] || {});
  const cats = {}; by('cat').forEach(c => cats[c.id] = c);
  const accts = by('acct'), pays = {}; by('pay').forEach(p => pays[p.id] = p);
  const txs = by('tx');
  const sd = Math.min(28, Math.max(1, Number(meta.startDay) || 1));
  let y = now.getFullYear(), m = now.getMonth(); if (now.getDate() < sd) { m--; if (m < 0) { m = 11; y--; } }
  const start = new Date(y, m, sd), end = new Date(y, m + 1, sd - 1), today = ymd(now);
  const byDate = {}, recs = [];
  for (const t of txs) { if (t.type === 'transfer') continue; if (t.rec) recs.push(t); else (byDate[t.date] = byDate[t.date] || []).push(t); }
  const top = id => { const c = cats[id]; if (!c) return { id: 'none', n: '분류 안 함', e: '', c: '#c7c7cc' }; return c.p && cats[c.p] ? cats[c.p] : c; };
  let inc = 0, exp = 0, finc = 0, fexp = 0, todayIn = 0, todayEx = 0, spentSoFar = 0;
  const catSum = {}, recent = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = ymd(d), list = (byDate[key] || []).concat(recs.filter(t => occurs(t, key)));
    for (const t of list) {
      const a = Number(t.amount) || 0;
      if (t.type === 'income') { if (t.rec) finc += a; else inc += a; if (key === today) todayIn += a; }
      else {
        if (t.rec) fexp += a; else exp += a;
        if (key === today) todayEx += a;
        if (key <= today) spentSoFar += a;
        const c = top(t.cat); catSum[c.id] = catSum[c.id] || { n: c.n, e: c.e || '', c: c.c || '#8e8e93', amt: 0 }; catSum[c.id].amt += a;
      }
      if (key <= today) recent.push({ key, t, label: (top(t.cat).e ? top(t.cat).e + ' ' : '') + (cats[t.cat] ? cats[t.cat].n : '분류 안 함') });
    }
  }
  recent.sort((a, b) => b.key.localeCompare(a.key));
  // 순자산 (오늘까지)
  const bal = {}, kind = {}; accts.forEach(a => { bal[a.id] = Number(a.opening) || 0; kind[a.id] = a.kind; });
  const mv = (id, x) => { if (id && id in bal) bal[id] += kind[id] === 'debt' ? -x : x; };
  for (const t of txs) {
    const n = countOcc(t, today); if (!n) continue; const a = (Number(t.amount) || 0) * n;
    if (t.type === 'income') mv(t.acct, a);
    else if (t.type === 'expense') mv(t.acct || (pays[t.pay] && pays[t.pay].acct), -a);
    else if (t.type === 'transfer') { mv(t.from, -(a + (Number(t.fee) || 0) * n)); mv(t.to, a); }
  }
  let assets = 0, debts = 0; accts.forEach(a => { if (a.kind === 'debt') debts += bal[a.id]; else assets += bal[a.id]; });
  const totalIn = inc + finc, totalEx = exp + fexp;
  return {
    meta, start, end, inc, exp, finc, fexp, totalIn, totalEx, net: totalIn - totalEx, todayIn, todayEx, spentSoFar,
    daysLeft: Math.round((end - pd(today)) / 864e5) + 1,
    topCats: Object.values(catSum).sort((a, b) => b.amt - a.amt).slice(0, 4),
    recent: recent.slice(0, 6), netWorth: assets - debts, hasAccts: accts.length > 0,
  };
}
function symOf(c) { try { return (new Intl.NumberFormat('ko-KR', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency') || {}).value || c; } catch (e) { return c === 'KRW' ? '₩' : c + ' '; } }
function fracOf(c) { try { return new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits; } catch (e) { return 0; } }
function money(n, c) { n = Math.round((Number(n) || 0) * 100) / 100; return (n < 0 ? '-' : '') + symOf(c) + Math.abs(n).toLocaleString('ko-KR', { maximumFractionDigits: fracOf(c) }); }
function compact(n, c) {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (c === 'KRW') { if (a >= 1e8) return s + (a / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억'; if (a >= 1e4) return s + (a / 1e4).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '만'; return s + Math.round(a).toLocaleString('ko-KR'); }
  if (a >= 1e6) return s + (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (a >= 1e3) return s + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return s + Math.round(a);
}
/* ==/CALC== */

/* ---------- 연결 코드 ---------- */
function parseCode(s) {
  const p = String(s || '').trim().split('|');
  if (p.length !== 4 || p[0] !== 'YSW1' || !/^https:\/\/.+/.test(p[1]) || p[3].length < 32) return null;
  return { url: p[1].replace(/\/+$/, ''), anon: p[2], key: p[3] };
}
function loadCfg() { return Keychain.contains(KC_KEY) ? parseCode(Keychain.get(KC_KEY)) : null; }
async function askCode() {
  const a = new Alert();
  a.title = '연결 코드 넣기';
  a.message = '가계부 앱 → 더보기 → 클라우드 동기화 → "연결 코드 만들기"에서 복사한 코드를 붙여넣어 주세요.';
  a.addTextField('YSW1|https://…', Pasteboard.paste() && String(Pasteboard.paste()).startsWith('YSW1|') ? String(Pasteboard.paste()) : '');
  a.addAction('저장'); a.addCancelAction('취소');
  if (await a.presentAlert() === -1) return null;
  const cfg = parseCode(a.textFieldValue(0));
  if (!cfg) { const e = new Alert(); e.title = '코드가 올바르지 않아요'; e.message = 'YSW1| 로 시작하는 코드 전체를 붙여넣어 주세요.'; e.addAction('확인'); await e.presentAlert(); return null; }
  Keychain.set(KC_KEY, a.textFieldValue(0).trim());
  return cfg;
}

/* ---------- 데이터 가져오기 (실패하면 마지막 저장본) ---------- */
async function getData(cfg, ledger) {
  const fm = FileManager.local(), path = fm.joinPath(fm.documentsDirectory(), 'yurim_budget_' + (ledger || 'default').replace(/[^\w가-힣]/g, '_') + '.json');
  try {
    const r = new Request(cfg.url + '/rest/v1/rpc/ys_w_items');
    r.method = 'POST'; r.timeoutInterval = 15;
    r.headers = { apikey: cfg.anon, Authorization: 'Bearer ' + cfg.anon, 'Content-Type': 'application/json' };
    r.body = JSON.stringify({ p_key: cfg.key, p_ledger: ledger || null });
    const j = await r.loadJSON();
    const st = r.response && r.response.statusCode;
    if (st >= 300 || !j || !j.items) throw new Error((j && j.message) || ('서버 응답 ' + st));
    fm.writeString(path, JSON.stringify({ at: Date.now(), items: j.items }));
    return { items: j.items, stale: false };
  } catch (e) {
    if (fm.fileExists(path)) { const c = JSON.parse(fm.readString(path)); return { items: c.items, stale: true, at: c.at, err: e.message }; }
    throw e;
  }
}

/* ---------- 위젯 그리기 ---------- */
const C = {
  bg: Color.dynamic(new Color('#ffffff'), new Color('#16181d')),
  ink: Color.dynamic(new Color('#1a1c22'), new Color('#f2f3f5')),
  muted: new Color('#8b919c'),
  inc: Color.dynamic(new Color('#16a974'), new Color('#2ed59a')),
  exp: Color.dynamic(new Color('#f04e6b'), new Color('#ff5e7a')),
  track: Color.dynamic(new Color('#eceef2'), new Color('#2a2d35')),
  accent: Color.dynamic(new Color('#5b63d8'), new Color('#7c83f0')),
};
function txt(stack, s, size, color, bold) { const t = stack.addText(String(s)); t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size); t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.5; return t; }
function row(stack, label, value, color, size = 12) { const r = stack.addStack(); r.layoutHorizontally(); r.centerAlignContent(); txt(r, label, size - 1, C.muted); r.addSpacer(); txt(r, value, size, color, true); return r; }
function bar(stack, ratio, color, width) { const o = stack.addStack(); o.size = new Size(width, 5); o.backgroundColor = C.track; o.cornerRadius = 2.5; o.layoutHorizontally(); const f = o.addStack(); f.size = new Size(Math.max(3, Math.round(width * Math.min(1, ratio))), 5); f.backgroundColor = color; f.cornerRadius = 2.5; o.addSpacer(); return o; }
function periodLabel(d) { const s = d.start, e = d.end; return s.getMonth() === e.getMonth() ? (s.getMonth() + 1) + '월' : (s.getMonth() + 1) + '/' + s.getDate() + '–' + (e.getMonth() + 1) + '/' + e.getDate(); }
function summaryCol(col, d, cur, big) {
  txt(col, d.meta.name + ' · ' + periodLabel(d), 11, C.muted, true);
  col.addSpacer(4);
  txt(col, '이번 달 지출', 11, C.muted);
  txt(col, money(-d.totalEx, cur), big ? 26 : 22, C.exp, true);
  col.addSpacer();
  row(col, '오늘', d.todayEx ? money(-d.todayEx, cur) : money(0, cur), d.todayEx ? C.exp : C.muted);
  col.addSpacer(3);
  row(col, '수입', money(d.totalIn, cur), C.inc);
  col.addSpacer(3);
  row(col, '합계', money(d.net, cur), d.net < 0 ? C.exp : C.ink);
}
function topCatsCol(col, d, cur, width) {
  txt(col, '많이 쓴 분류', 11, C.muted, true); col.addSpacer(6);
  if (!d.topCats.length) { txt(col, '아직 지출이 없어요', 12, C.muted); return; }
  const max = d.topCats[0].amt || 1, total = d.totalEx || 1;
  d.topCats.slice(0, 3).forEach((c, i) => {
    const r = col.addStack(); r.layoutHorizontally(); txt(r, (c.e ? c.e + ' ' : '') + c.n, 11, C.ink); r.addSpacer(); txt(r, Math.round(c.amt / total * 100) + '%', 11, C.muted);
    col.addSpacer(3); bar(col, c.amt / max, new Color(c.c), width); if (i < 2) col.addSpacer(7);
  });
}
function footer(w, data) { if (data.stale) { w.addSpacer(2); txt(w, '⚠︎ 연결이 안 돼서 마지막 저장본이에요', 9, C.muted); } }

function build(family, d, data) {
  const cur = d.meta.currency || 'KRW', w = new ListWidget();
  w.url = APP_URL; w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (family === 'accessoryInline') { txt(w, '지출 ' + money(-d.totalEx, cur) + (d.todayEx ? ' · 오늘 ' + compact(-d.todayEx, cur) : ''), 12, Color.white()); return w; }
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
    const a = s.addStack(); a.addSpacer(); txt(a, '오늘', 10, Color.white()); a.addSpacer();
    const b = s.addStack(); b.addSpacer(); txt(b, compact(d.todayEx, cur), 15, Color.white(), true); b.addSpacer();
    return w;
  }
  if (family === 'accessoryRectangular') {
    txt(w, '💸 ' + periodLabel(d) + ' 지출', 12, Color.white(), true);
    txt(w, money(-d.totalEx, cur), 17, Color.white(), true);
    txt(w, '오늘 ' + money(-d.todayEx, cur) + ' · 합계 ' + compact(d.net, cur), 11, Color.white());
    return w;
  }
  w.backgroundColor = C.bg; w.setPadding(14, 15, 12, 15);
  if (family === 'small') { summaryCol(w, d, cur, false); footer(w, data); return w; }
  const top = w.addStack(); top.layoutHorizontally();
  const left = top.addStack(); left.layoutVertically(); summaryCol(left, d, cur, family !== 'medium');
  top.addSpacer(16);
  const right = top.addStack(); right.layoutVertically(); topCatsCol(right, d, cur, family === 'medium' ? 120 : 130);
  if (family === 'medium') { footer(w, data); return w; }
  // 크게: 순자산 + 최근 내역
  w.addSpacer(10);
  const line = w.addStack(); line.size = new Size(0, 1); line.backgroundColor = C.track; line.addSpacer();
  w.addSpacer(8);
  if (d.hasAccts) { row(w, '순자산', money(d.netWorth, cur), d.netWorth < 0 ? C.exp : C.accent, 13); w.addSpacer(8); }
  txt(w, '최근 내역', 11, C.muted, true); w.addSpacer(4);
  if (!d.recent.length) txt(w, '아직 기록이 없어요', 12, C.muted);
  d.recent.slice(0, d.hasAccts ? 4 : 5).forEach(x => {
    const r = w.addStack(); r.layoutHorizontally();
    txt(r, x.key.slice(5).replace('-', '/') + '  ', 11, C.muted); txt(r, x.label + (x.t.memo ? ' · ' + x.t.memo : ''), 11, C.ink); r.addSpacer();
    txt(r, (x.t.type === 'income' ? '' : '-') + money(x.t.amount, cur), 11, x.t.type === 'income' ? C.inc : C.exp, true);
    w.addSpacer(3);
  });
  w.addSpacer(); footer(w, data);
  return w;
}
function message(family, title, body) {
  const w = new ListWidget(); w.url = APP_URL;
  if (family && family.startsWith('accessory')) { txt(w, title, 12, Color.white(), true); return w; }
  w.backgroundColor = C.bg; w.setPadding(14, 14, 14, 14);
  txt(w, title, 14, C.ink, true); w.addSpacer(6); const b = w.addText(body); b.font = Font.systemFont(11); b.textColor = C.muted;
  return w;
}

/* ---------- 실행 ---------- */
async function main() {
  const family = config.widgetFamily || 'medium', ledger = (args.widgetParameter || '').trim();
  let cfg = loadCfg();
  if (!config.runsInWidget) {
    if (!cfg) cfg = await askCode();
    else {
      const a = new Alert(); a.title = '유림 가계부 위젯'; a.message = '무엇을 할까요?';
      ['중간 크기 미리보기', '작은 크기 미리보기', '큰 크기 미리보기', '연결 코드 다시 넣기', '연결 코드 지우기'].forEach(x => a.addAction(x)); a.addCancelAction('닫기');
      const i = await a.presentSheet();
      if (i === 3) cfg = await askCode();
      else if (i === 4) { Keychain.remove(KC_KEY); cfg = null; }
      else if (i === -1) return;
      else {
        const fam = ['medium', 'small', 'large'][i];
        try { const data = await getData(cfg, ledger); const w = build(fam, compute(data.items, new Date()), data); await w['present' + fam[0].toUpperCase() + fam.slice(1)](); }
        catch (e) { const er = new Alert(); er.title = '불러오지 못했어요'; er.message = e.message; er.addAction('확인'); await er.presentAlert(); }
        return;
      }
    }
    if (!cfg) return;
    try { const data = await getData(cfg, ledger); await build('medium', compute(data.items, new Date()), data).presentMedium(); }
    catch (e) { const er = new Alert(); er.title = '불러오지 못했어요'; er.message = e.message; er.addAction('확인'); await er.presentAlert(); }
    return;
  }
  let w;
  if (!cfg) w = message(family, '연결이 필요해요', 'Scriptable 앱에서 이 스크립트를 한 번 실행하고 연결 코드를 넣어 주세요.');
  else {
    try { const data = await getData(cfg, ledger); w = build(family, compute(data.items, new Date()), data); }
    catch (e) { w = message(family, '불러오지 못했어요', e.message); }
  }
  Script.setWidget(w);
}
await main();
Script.complete();
