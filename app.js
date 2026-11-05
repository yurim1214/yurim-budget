'use strict';
/* =====================================================================
   유림 가계부 v3
   - 모든 데이터(내역·분류·자산·결제 수단·가계부 설정)를 "항목(item)" 단위로 저장
   - 항목마다 수정 시각(updated_at)이 있어서, 여러 기기에서 고쳐도 가장 최근 것이 남음
   - 로그인하면 Supabase 의 ys_items 표와 자동 동기화
   ===================================================================== */

/* ===================== 유틸 ===================== */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayKey = () => ymd(new Date());
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function rcode(n) { const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = crypto.getRandomValues(new Uint32Array(n)); let s = ''; for (let i = 0; i < n; i++) s += ch[a[i] % ch.length]; return s; }
function gS(k, d) { try { const v = localStorage.getItem('ys_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function sS(k, v) { try { localStorage.setItem('ys_' + k, JSON.stringify(v)); } catch (e) { } }
function rawGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
const fmtDate = key => { const d = pd(key); return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '. (' + DOW[d.getDay()] + ')'; };
const byOrder = (a, b) => ((a.o ?? 999) - (b.o ?? 999)) || String(a.n || a.name || '').localeCompare(String(b.n || b.name || ''), 'ko');

/* ===================== 통화 ===================== */
const CURRENCIES = [['KRW', '대한민국 원'], ['USD', '미국 달러'], ['JPY', '일본 엔'], ['EUR', '유로'], ['CNY', '중국 위안'], ['GBP', '영국 파운드'], ['TWD', '대만 달러'], ['HKD', '홍콩 달러'], ['VND', '베트남 동'], ['THB', '태국 바트'], ['PHP', '필리핀 페소'], ['AUD', '호주 달러'], ['CAD', '캐나다 달러'], ['SGD', '싱가포르 달러'], ['CHF', '스위스 프랑']];
const _frac = {}, _sym = {};
function fracOf(c) { if (!(c in _frac)) { try { _frac[c] = new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits; } catch (e) { _frac[c] = 0; } } return _frac[c]; }
function symOf(c) { if (!(c in _sym)) { try { _sym[c] = (new Intl.NumberFormat('ko-KR', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency') || {}).value || c; } catch (e) { _sym[c] = c; } } return _sym[c]; }
const cur = () => Ledgers.meta().currency || 'KRW';
function num(n, c = cur()) { return Number(n || 0).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: fracOf(c) }); }
function money(n, c = cur()) { n = Math.round((Number(n) || 0) * 100) / 100; return (n < 0 ? '-' : '') + symOf(c) + num(Math.abs(n), c); }
function cellAmt(n) { if (cur() === 'KRW' && n >= 1000000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만'; return Math.round(n).toLocaleString('ko-KR'); }
function parseAmt(s) { const v = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(v) ? v : 0; }
function bindAmtInput(el, after) {
  el.addEventListener('input', () => {
    const f = fracOf(cur()); let r = el.value.replace(/[^0-9.]/g, '');
    if (!f) r = r.replace(/\./g, '');
    else { const i = r.indexOf('.'); if (i >= 0) r = r.slice(0, i + 1) + r.slice(i + 1).replace(/\./g, '').slice(0, f); }
    if (!r) el.value = ''; else { const [a, b] = r.split('.'); el.value = Number(a || 0).toLocaleString('ko-KR') + (b !== undefined ? '.' + b : ''); }
    if (after) after();
  });
}

/* ===================== 저장소 (항목 단위) ===================== */
const DB = {
  KEY: 'ys3_items', map: {}, ver: 0, _c: {},
  load() { this.map = rawGet(this.KEY) || {}; this.ver++; this._c = {}; },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.map)); } catch (e) { toast('기기 저장 공간이 부족해요'); } },
  touch(persist = true) { this.ver++; this._c = {}; if (persist) this.save(); },
  k(kind, lg, id) { return kind + ':' + lg + ':' + id; },
  list(kind, lg = activeLedger) {
    const ck = kind + '|' + lg; if (this._c[ck]) return this._c[ck];
    const out = []; for (const it of Object.values(this.map)) if (it.kind === kind && it.ledger === lg && !it.deleted) out.push(it.data);
    return (this._c[ck] = out);
  },
  get(kind, id, lg = activeLedger) { const it = this.map[this.k(kind, lg, id)]; return it && !it.deleted ? it.data : null; },
  put(kind, data, lg = activeLedger, ts) {
    const k = this.k(kind, lg, data.id);
    this.map[k] = { id: k, kind, ledger: lg, data, updated_at: ts ?? Date.now(), deleted: false, dirty: true };
    if (ts === undefined) { this.touch(); Sync.schedule(); }
  },
  del(kind, id, lg = activeLedger) {
    const k = this.k(kind, lg, id), it = this.map[k]; if (!it) return;
    it.deleted = true; it.updated_at = Date.now(); it.dirty = true; this.touch(); Sync.schedule();
  },
};

/* ===================== 기본값 ===================== */
const DEFAULT_CATS = [
  { id: 'i_salary', t: 'income', n: '월급', e: '💸', c: '#2f80ed' },
  { id: 'i_allow', t: 'income', n: '용돈', e: '🧧', c: '#34c759' },
  { id: 'i_etc', t: 'income', n: '기타', e: '➕', c: '#8e8e93' },
  { id: 'e_food', t: 'expense', n: '식비', e: '🍚', c: '#ff9500' },
  { id: 'e_cafe', t: 'expense', n: '카페', e: '☕', c: '#a2845e' },
  { id: 'e_home', t: 'expense', n: '주거', e: '🏠', c: '#ffcc00' },
  { id: 'e_tel', t: 'expense', n: '통신비', e: '📡', c: '#af52de' },
  { id: 'e_trans', t: 'expense', n: '교통비', e: '🚇', c: '#eb5757' },
  { id: 'e_shop', t: 'expense', n: '쇼핑', e: '🛍️', c: '#ff2d55' },
  { id: 'e_sub', t: 'expense', n: '구독', e: '📺', c: '#5e5ce6' },
  { id: 'e_etc', t: 'expense', n: '기타', e: '📌', c: '#8e8e93' },
];
const DEFAULT_ACCTS = [
  { id: 'a_cash', name: '현금', emoji: '💵', color: '#34c759', kind: 'cash', opening: 0 },
  { id: 'a_bank', name: '주거래 통장', emoji: '🏦', color: '#2f80ed', kind: 'checking', opening: 0 },
];
const DEFAULT_PAYS = [
  { id: 'pm_card', n: '카드', e: '💳' },
  { id: 'pm_cash', n: '현금', e: '💵', acct: 'a_cash' },
];
const NONE = { id: 'none', n: '분류 안 함', e: '', c: '#c7c7cc' };
const KINDS = { cash: '현금', checking: '입출금 계좌', savings: '저축 계좌', debt: '부채' };
const SWATCH = ['#eb5757', '#ff9500', '#ffcc00', '#34c759', '#2f80ed', '#5e5ce6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93'];
const QUICK = ['🍚', '🍽️', '☕', '🛒', '🏠', '🚇', '💸', '💊', '🎬', '👕', '📱', '🎁', '💎', '✈️', '🐶', '📚', '📺', '💡', '🏋️', '🍺'];
const ASSET_EMOJI = ['💵', '🏦', '🐷', '💳', '📈', '🪙', '💰', '🏠', '🚗', '💎', '🧧', '📊'];
const PAY_EMOJI = ['💳', '💵', '🏦', '📱', '🪙', '🎫'];

/* ===================== 가계부(원장) ===================== */
let activeLedger = gS('active3', 'local');
const Ledgers = {
  def() { return gS('defCode', 'local'); },
  codes() { let l = gS('ledgers3', null); if (!Array.isArray(l) || !l.length) { l = [this.def()]; sS('ledgers3', l); } return l; },
  add(code) { const l = this.codes(); if (!l.includes(code)) { l.push(code); sS('ledgers3', l); } },
  remove(code) { sS('ledgers3', this.codes().filter(c => c !== code)); },
  _mc: {}, _mv: -1,
  meta(code = activeLedger) {
    if (this._mv !== DB.ver) { this._mc = {}; this._mv = DB.ver; }
    if (this._mc[code]) return this._mc[code];
    const m = DB.get('meta', 'meta', code); const names = gS('lgNames', {});
    return (this._mc[code] = Object.assign({ id: 'meta', name: code === this.def() ? '기본 가계부' : (names[code] || '가계부'), currency: 'KRW', startDay: 1, shared: !code.startsWith('p_') && !code.startsWith('l_') && code !== 'local' }, m || {}));
  },
  setMeta(patch, code = activeLedger) { DB.put('meta', Object.assign({}, this.meta(code), patch, { id: 'meta' }), code); },
};
const startDay = () => Math.min(28, Math.max(1, Number(Ledgers.meta().startDay) || 1));
function seedLedger(code, meta, ts) {
  DB.put('meta', Object.assign({ id: 'meta', currency: 'KRW', startDay: 1, shared: false }, meta), code, ts ?? Date.now());
  DEFAULT_CATS.forEach((c, i) => DB.put('cat', { ...c, o: i }, code, ts ?? Date.now()));
  DEFAULT_ACCTS.forEach((a, i) => DB.put('acct', { ...a, o: i }, code, ts ?? Date.now()));
  DEFAULT_PAYS.forEach((p, i) => DB.put('pay', { ...p, o: i }, code, ts ?? Date.now()));
  DB.touch(); Sync.schedule();
}
function setActive(code) { activeLedger = code; sS('active3', code); anchorToToday(); rerenderAll(); }

/* ===================== 분류 / 결제 수단 / 자산 접근 ===================== */
const Cats = {
  all: () => DB.list('cat'),
  byType: t => Cats.all().filter(c => c.t === t).slice().sort(byOrder),
  tops: t => Cats.byType(t).filter(c => !c.p || !DB.get('cat', c.p)),
  subs: id => Cats.all().filter(c => c.p === id).slice().sort(byOrder),
  get: id => (id && DB.get('cat', id)) || NONE,
  top: id => { const c = Cats.get(id); return c.p && DB.get('cat', c.p) ? DB.get('cat', c.p) : c; },
};
function catLabel(id) { const c = Cats.get(id); if (c.p) { const p = DB.get('cat', c.p); if (p) return (p.e ? p.e + ' ' : '') + p.n + ' › ' + c.n + (c.e ? ' ' + c.e : ''); } return c.n + (c.e ? ' ' + c.e : ''); }
const Pays = { all: () => DB.list('pay').slice().sort(byOrder), get: id => id ? DB.get('pay', id) : null };
const Accts = { all: () => DB.list('acct').slice().sort(byOrder), get: id => id ? DB.get('acct', id) : null };
function defCat(type) { const c = Cats.byType(type).find(x => x.def); return c ? c.id : 'none'; }
function defPay() { const p = Pays.all().find(x => x.def); return p ? p.id : null; }

/* ===================== 반복 ===================== */
const REP_IDS = ['none', 'daily', 'weekdays', 'weekends', 'weekly', 'biweekly', 'monthly', 'monthEnd', 'm2', 'm3', 'm6', 'yearly'];
function repText(f, date) {
  const d = pd(date), dd = d.getDate(), w = DOW[d.getDay()] + '요일';
  return ({ none: '안 함', daily: '매일', weekdays: '평일마다 (월~금)', weekends: '주말마다 (토·일)', weekly: '매주 ' + w, biweekly: '2주마다 ' + w, monthly: '매달 ' + dd + '일', monthEnd: '매달 마지막 날', m2: '2개월마다 ' + dd + '일', m3: '3개월마다 ' + dd + '일', m6: '6개월마다 ' + dd + '일', yearly: '매년 ' + (d.getMonth() + 1) + '월 ' + dd + '일' })[f] || '안 함';
}
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
function occDates(t, from, to) {
  const out = []; if (!t.rec) { if (t.date >= from && t.date <= to) out.push(t.date); return out; }
  let a = t.date > from ? t.date : from; const b = t.rec.end && t.rec.end < to ? t.rec.end : to;
  for (let d = pd(a); ; d = addDays(d, 1)) { const k = ymd(d); if (k > b) break; if (occurs(t, k)) out.push(k); }
  return out;
}

/* ===================== 집계 ===================== */
let _ix = null, _ixv = -1, _ixl = null;
function txIndex() {
  if (_ix && _ixv === DB.ver && _ixl === activeLedger) return _ix;
  const byDate = {}, recs = [], trs = [];
  for (const t of DB.list('tx')) { if (t.type === 'transfer') { trs.push(t); continue; } if (t.rec) recs.push(t); else (byDate[t.date] = byDate[t.date] || []).push(t); }
  _ixv = DB.ver; _ixl = activeLedger; return (_ix = { byDate, recs, trs });
}
function txOn(key) { const ix = txIndex(); const out = (ix.byDate[key] || []).slice(); for (const t of ix.recs) if (occurs(t, key)) out.push(t); return out; }
function period(y, m) { const sd = startDay(); return { start: new Date(y, m, sd), end: new Date(y, m + 1, sd - 1) }; }
function collect(y, m) {
  const { start, end } = period(y, m); const dayMap = {}, items = []; let inc = 0, exp = 0, finc = 0, fexp = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = ymd(d); let di = 0, de = 0;
    for (const t of txOn(key)) {
      items.push({ t, key });
      if (t.type === 'income') { di += t.amount; if (t.rec) finc += t.amount; else inc += t.amount; }
      else { de += t.amount; if (t.rec) fexp += t.amount; else exp += t.amount; }
    }
    if (di || de) dayMap[key] = { in: di, ex: de };
  }
  return { start, end, dayMap, inc, exp, finc, fexp, items };
}
function txAcct(t) { if (t.type === 'income') return t.acct || null; if (t.type === 'expense') { if (t.acct) return t.acct; const p = Pays.get(t.pay); return p && p.acct ? p.acct : null; } return null; }
function balances() {
  const accts = DB.list('acct'), b = {}, kind = {}; accts.forEach(a => { b[a.id] = Number(a.opening) || 0; kind[a.id] = a.kind; });
  const mv = (id, x) => { if (id in b) b[id] += kind[id] === 'debt' ? -x : x; };
  const today = todayKey();
  for (const t of DB.list('tx')) {
    if (t.date > today) continue;
    const n = t.rec ? occDates(t, t.date, today).length : 1; if (!n) continue;
    if (t.type === 'income') mv(txAcct(t), t.amount * n);
    else if (t.type === 'expense') mv(txAcct(t), -t.amount * n);
    else if (t.type === 'transfer') { mv(t.from, -(t.amount + (Number(t.fee) || 0)) * n); mv(t.to, t.amount * n); }
  }
  return b;
}
function netWorth(b = balances()) { let a = 0, d = 0; for (const x of DB.list('acct')) { if (x.kind === 'debt') d += b[x.id] || 0; else a += b[x.id] || 0; } return { a, d, net: a - d }; }

/* ===================== 상태 ===================== */
let anchorY, anchorM, selDate = todayKey();
function anchorToToday() { const t = new Date(); anchorY = t.getFullYear(); anchorM = t.getMonth(); if (t.getDate() < startDay()) { anchorM--; if (anchorM < 0) { anchorM = 11; anchorY--; } } }
function anchorToDate(key) { const d = pd(key); anchorY = d.getFullYear(); anchorM = d.getMonth(); if (d.getDate() < startDay()) { anchorM--; if (anchorM < 0) { anchorM = 11; anchorY--; } } }
function inPeriod(key) { const { start, end } = period(anchorY, anchorM); return key >= ymd(start) && key <= ymd(end); }

/* ===================== 달력 화면 ===================== */
function render() {
  const { start, end, dayMap, inc, exp, finc, fexp } = collect(anchorY, anchorM);
  const mt = $('monthTitle');
  mt.innerHTML = start.getMonth() === end.getMonth()
    ? (start.getMonth() + 1) + '월 <span>' + start.getFullYear() + '</span><span class="cv">▾</span>'
    : (start.getMonth() + 1) + '월 ' + start.getDate() + '일 - ' + (end.getMonth() + 1) + '월 ' + end.getDate() + '일<span class="cv">▾</span>';
  const meta = Ledgers.meta();
  $('lgName').textContent = Ledgers.codes().length > 1 || meta.shared ? meta.name + (meta.shared ? ' 👥' : '') : '';
  fillSummary('', inc, exp, finc, fexp);
  const nw = netWorth().net, nwe = $('sNetWorth'); nwe.textContent = money(nw); nwe.classList.toggle('neg', nw < 0);
  const grid = $('grid'); grid.innerHTML = '';
  const lead = start.getDay(), total = Math.round((end - start) / 864e5) + 1, weeks = Math.ceil((lead + total) / 7);
  grid.style.gridTemplateRows = 'repeat(' + weeks + ',1fr)';
  const tk = todayKey(), frag = document.createDocumentFragment();
  for (let i = 0; i < lead; i++) frag.appendChild(cell(null));
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) frag.appendChild(cell(new Date(d), dayMap[ymd(d)], tk));
  for (let i = 0; i < weeks * 7 - (lead + total); i++) frag.appendChild(cell(null));
  grid.appendChild(frag);
}
function cell(d, sums, tk) {
  const c = document.createElement('div');
  if (!d) { c.className = 'cell empty'; return c; }
  const key = ymd(d), dw = d.getDay();
  c.className = 'cell' + (dw === 0 ? ' sun' : dw === 6 ? ' sat' : '') + (key === tk ? ' today' : '');
  let h = '<div class="dn">' + d.getDate() + '</div>';
  if (sums) { if (sums.in) h += '<div class="amt in num">' + cellAmt(sums.in) + '</div>'; if (sums.ex) h += '<div class="amt ex num">' + cellAmt(sums.ex) + '</div>'; }
  c.innerHTML = h; c.onclick = () => openDay(key); return c;
}
function fillSummary(p, inc, exp, finc, fexp) {
  const g = id => $(p + id), neg = v => v ? '-' + money(v) : money(0);
  g('sInc').textContent = money(inc); g('sExp').textContent = neg(exp);
  g('sFinc').textContent = money(finc); g('sFexp').textContent = neg(fexp);
  g('sTinc').textContent = money(inc + finc); g('sTexp').textContent = neg(exp + fexp);
  const net = (inc + finc) - (exp + fexp), ne = g('sNet'); ne.textContent = money(net); ne.classList.toggle('neg', net < 0);
}
function shift(n) { anchorM += n; if (anchorM < 0) { anchorM = 11; anchorY--; } else if (anchorM > 11) { anchorM = 0; anchorY++; } render(); }

/* ===================== 내역 행 ===================== */
function txSub(t) {
  const parts = [];
  if (t.rec) parts.push('↻ ' + repText(t.rec.f, t.date) + (t.rec.end ? ' (~' + t.rec.end.slice(2).replace(/-/g, '.') + ')' : ''));
  if (t.type === 'expense') { const p = Pays.get(t.pay); if (p) parts.push((p.e ? p.e + ' ' : '') + p.n); }
  if (t.type === 'income') { const a = Accts.get(t.acct); if (a) parts.push('→ ' + a.name); }
  if (t.memo) parts.push(t.memo);
  return parts.join(' · ');
}
function txRow(t, key, opt = {}) {
  if (t.type === 'transfer') {
    const f = Accts.get(t.from), to = Accts.get(t.to);
    return '<div class="tx" data-id="' + esc(t.id) + '" data-occ="' + key + '" data-tr="1" style="border-left-color:var(--accent)"><div class="nm"><div class="t">⇄ ' + esc((f ? f.name : '?') + ' → ' + (to ? to.name : '?')) + '</div><div class="s">' + esc((opt.showDate ? fmtDate(key) + ' · ' : '') + (t.fee ? '수수료 ' + money(t.fee) : '') + (t.memo ? (t.fee ? ' · ' : '') + t.memo : '')) + '</div></div><div class="a tr num">' + money(opt.delta ?? t.amount) + '</div></div>';
  }
  const c = Cats.get(t.cat), sub = (opt.showDate ? fmtDate(key) + (txSub(t) ? ' · ' : '') : '') + txSub(t);
  const amt = opt.delta !== undefined ? money(opt.delta) : (t.type === 'income' ? money(t.amount) : '-' + money(t.amount));
  return '<div class="tx" data-id="' + esc(t.id) + '" data-occ="' + key + '" style="border-left-color:' + c.c + '"><div class="nm"><div class="t">' + esc(catLabel(t.cat)) + '</div>' + (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div><div class="a ' + (t.type === 'income' ? 'in' : 'ex') + ' num">' + amt + '</div></div>';
}
function bindTxRows(root, before) {
  root.querySelectorAll('.tx').forEach(el => el.onclick = () => { if (before) before(); if (el.dataset.tr) openTransfer(null, el.dataset.id); else openForm(null, el.dataset.id, el.dataset.occ); });
}

/* ===================== 날짜 상세 ===================== */
function openDay(key) {
  selDate = key; $('dayDt').textContent = fmtDate(key);
  const list = txOn(key), body = $('dayBody');
  if (!list.length) body.innerHTML = '<div class="empty">기록이 없습니다</div>';
  else {
    const groups = [['고정 수입', list.filter(t => t.type === 'income' && t.rec)], ['수입', list.filter(t => t.type === 'income' && !t.rec)], ['고정 지출', list.filter(t => t.type === 'expense' && t.rec)], ['지출', list.filter(t => t.type === 'expense' && !t.rec)]];
    body.innerHTML = groups.filter(g => g[1].length).map(([title, items]) => '<div class="grp-h"><span>' + title + '</span><span>' + money(items.reduce((s, t) => s + t.amount, 0)) + '</span></div>' + items.map(t => txRow(t, key)).join('')).join('');
    bindTxRows(body);
  }
  show('dayOv');
}
function refreshDay() { if ($('dayOv').classList.contains('show')) openDay(selDate); }

/* ===================== 입력 폼 ===================== */
let form = {};
function openForm(type, editId, occ) {
  if (editId) {
    const t = DB.get('tx', editId); if (!t) return;
    form = { type: t.type, cat: t.cat || 'none', pay: t.pay || null, acct: t.acct || null, rec: t.rec ? { f: t.rec.f, end: t.rec.end || null } : null, occ: occ || t.date, orig: t };
    $('fAmt').value = num(t.amount); $('fMemo').value = t.memo || '';
    $('fDate').value = t.rec ? (occ || t.date) : t.date;
    $('fDel').style.display = 'block'; $('fSave').textContent = '편집 완료';
  } else {
    type = type || 'expense';
    form = { type, cat: defCat(type), pay: type === 'expense' ? defPay() : null, acct: null, rec: null, occ: null, orig: null };
    $('fAmt').value = ''; $('fMemo').value = ''; $('fDate').value = selDate;
    $('fDel').style.display = 'none'; $('fSave').textContent = '기록';
  }
  syncForm(); show('formOv');
  if (!editId) setTimeout(() => $('fAmt').focus(), 280);
}
function syncForm() {
  const ex = form.type === 'expense', w = ex ? '지출' : '수입';
  $('segIn').className = ex ? '' : 'on'; $('segEx').className = ex ? 'on' : '';
  $('fCatLabel').textContent = w + ' 분류';
  const c = Cats.get(form.cat); $('fCatName').textContent = catLabel(form.cat); document.querySelector('#fCatChip .dot').style.background = c.c;
  const date = $('fDate').value || selDate, tk = todayKey();
  const rel = date === tk ? '오늘, ' : date === ymd(addDays(new Date(), -1)) ? '어제, ' : date === ymd(addDays(new Date(), 1)) ? '내일, ' : '';
  $('fDateName').textContent = rel + fmtDate(date);
  if (ex) { $('fPayLabel').textContent = '결제 수단'; const p = Pays.get(form.pay); $('fPayName').textContent = p ? (p.e ? p.e + ' ' : '') + p.n : '선택 안 함'; }
  else { $('fPayLabel').textContent = '입금 계좌'; const a = Accts.get(form.acct); $('fPayName').textContent = a ? (a.emoji ? a.emoji + ' ' : '') + a.name : '선택 안 함'; }
  $('fRepLabel').textContent = '반복 (고정 ' + w + ')';
  $('fRepName').textContent = form.rec ? repText(form.rec.f, date) + (form.rec.end ? ' ~' + form.rec.end : '') : '안 함';
  amtShow();
}
function amtShow() {
  const v = parseAmt($('fAmt').value), el = $('fAmtShow');
  el.textContent = money(v); el.className = 'amtshow ' + (form.type === 'expense' ? 'ex' : 'in');
  $('fSave').className = 'ok ' + (v ? (form.type === 'expense' ? 'ex' : 'in') : '');
}
function setFormType(t) {
  if (form.type === t) return; form.type = t;
  if (form.cat !== 'none' && Cats.get(form.cat).t !== t) form.cat = form.orig ? 'none' : defCat(t);
  if (t === 'expense') { form.acct = null; if (!form.pay && !form.orig) form.pay = defPay(); } else form.pay = null;
  syncForm();
}
async function saveForm() {
  const amt = parseAmt($('fAmt').value); if (!amt) { toast('금액을 입력해 주세요'); return; }
  const date = $('fDate').value || selDate, memo = $('fMemo').value.trim();
  const base = { type: form.type, amount: amt, date, cat: form.cat, memo };
  if (form.type === 'expense') { if (form.pay) base.pay = form.pay; } else if (form.acct) base.acct = form.acct;
  if (form.rec) { base.rec = { f: form.rec.f }; if (form.rec.end) base.rec.end = form.rec.end; if (base.rec.end && base.rec.end < date) { toast('반복 종료일이 시작일보다 빨라요'); return; } }
  const o = form.orig;
  if (!o) DB.put('tx', { id: rid(), ...base });
  else if (!o.rec) DB.put('tx', { ...base, id: o.id });
  else {
    const w = o.type === 'income' ? '수입' : '지출';
    const ch = await pick('반복 ' + w + ' 편집', [{ id: 'one', label: '이 ' + w + '만 편집' }, { id: 'future', label: '이 ' + w + ' 및 이후 모든 ' + w + ' 편집' }], undefined, '이 ' + w + '은 반복(고정) ' + w + '입니다.');
    if (!ch) return;
    if (ch === 'one') {
      DB.put('tx', { ...o, rec: { ...o.rec, skip: [...(o.rec.skip || []), form.occ] } });
      const one = { ...base, id: rid() }; delete one.rec; DB.put('tx', one);
    } else if (form.occ <= o.date) {
      const n = { ...base, id: o.id }; if (n.rec && o.rec.skip) n.rec.skip = o.rec.skip.filter(k => k >= date); DB.put('tx', n);
    } else {
      DB.put('tx', { ...o, rec: { ...o.rec, end: ymd(addDays(pd(form.occ), -1)) } });
      DB.put('tx', { ...base, id: rid() });
    }
  }
  hide('formOv'); selDate = date; if (!inPeriod(date)) anchorToDate(date); render(); refreshDay(); refreshOpenSheets();
}
async function delForm() {
  const o = form.orig; if (!o) return;
  if (!o.rec) { if (!confirm('삭제하면 복구할 수 없습니다. 삭제하시겠습니까?')) return; DB.del('tx', o.id); }
  else {
    const w = o.type === 'income' ? '수입' : '지출';
    const ch = await pick('반복 ' + w + ' 삭제', [{ id: 'one', label: '이 ' + w + '만 삭제', danger: 1 }, { id: 'future', label: '이 ' + w + ' 및 이후 모든 ' + w + ' 삭제', danger: 1 }, { id: 'all', label: '모든 ' + w + ' 삭제', danger: 1 }], undefined, '이 ' + w + '은 반복(고정) ' + w + '입니다. 삭제하면 복구할 수 없습니다.');
    if (!ch) return;
    if (ch === 'one') DB.put('tx', { ...o, rec: { ...o.rec, skip: [...(o.rec.skip || []), form.occ] } });
    else if (ch === 'future' && form.occ > o.date) DB.put('tx', { ...o, rec: { ...o.rec, end: ymd(addDays(pd(form.occ), -1)) } });
    else DB.del('tx', o.id);
  }
  hide('formOv'); render(); refreshDay(); refreshOpenSheets();
}
async function pickPayOrAcct() {
  if (form.type === 'expense') {
    const items = Pays.all().map(p => { const a = Accts.get(p.acct); return { id: p.id, label: p.n, em: p.e, sub: a ? '연결: ' + a.name : '' }; });
    items.push({ id: '__none', label: '선택 안 함' }, { id: '__manage', label: '＋ 결제 수단 관리' });
    const v = await pick('결제 수단', items, form.pay || '__none'); if (!v) return;
    if (v === '__manage') { openPayMgr(); return; }
    form.pay = v === '__none' ? null : v;
  } else {
    const b = balances();
    const items = Accts.all().map(a => ({ id: a.id, label: a.name, em: a.emoji, sub: KINDS[a.kind] + ' · ' + money(b[a.id] || 0) }));
    items.push({ id: '__none', label: '선택 안 함' });
    const v = await pick('입금 계좌', items, form.acct || '__none'); if (!v) return;
    form.acct = v === '__none' ? null : v;
  }
  syncForm();
}

/* ===================== 반복 선택 ===================== */
let repTmp = 'none';
function openRep() {
  repTmp = form.rec ? form.rec.f : 'none';
  $('repTitle').textContent = '반복 (고정 ' + (form.type === 'expense' ? '지출' : '수입') + ')';
  $('repEndOn').checked = !!(form.rec && form.rec.end);
  $('repEnd').value = (form.rec && form.rec.end) || ymd(addDays(pd($('fDate').value || selDate), 365));
  renderRep(); show('repOv');
}
function renderRep() {
  const date = $('fDate').value || selDate;
  $('repList').innerHTML = REP_IDS.map(f => '<div class="ci' + (f === repTmp ? ' sel' : '') + '" data-f="' + f + '"><div class="radio"></div><span class="nm">' + repText(f, date) + '</span></div>').join('');
  $('repList').querySelectorAll('.ci').forEach(el => el.onclick = () => { repTmp = el.dataset.f; renderRep(); });
  $('repEndRow').style.display = repTmp !== 'none' && $('repEndOn').checked ? 'flex' : 'none';
}
function doneRep() { form.rec = repTmp === 'none' ? null : { f: repTmp, end: $('repEndOn').checked ? ($('repEnd').value || null) : null }; hide('repOv'); syncForm(); }

/* ===================== 분류 선택 / 편집 ===================== */
let pickType = 'expense', pickFromForm = false;
function openPicker(type, fromForm) { pickType = type; pickFromForm = fromForm; renderPicker(); show('pickOv'); }
function renderPicker() {
  const w = pickType === 'income' ? '수입' : '지출';
  $('pkTitle').textContent = w + ' 분류 항목';
  $('pkDesc').textContent = '가계부마다 나만의 ' + w + ' 분류를 만들 수 있어요. ＋로 추가하고, ✎로 편집해서 소분류로 묶을 수 있어요.';
  const curSel = pickFromForm ? form.cat : null, rows = [];
  for (const c of Cats.tops(pickType)) { rows.push(ciRow(c, c.id === curSel)); for (const s of Cats.subs(c.id)) rows.push(ciRow(s, s.id === curSel, true)); }
  if (pickFromForm) rows.push(ciRow(NONE, curSel === 'none'));
  $('pkList').innerHTML = rows.join('') || '<div class="empty">＋ 버튼으로 분류를 추가해 보세요</div>';
  $('pkList').querySelectorAll('.ci').forEach(el => {
    el.onclick = () => { if (pickFromForm) { form.cat = el.dataset.id; renderPicker(); } else if (el.dataset.id !== 'none') openEditor(el.dataset.id); };
    const ed = el.querySelector('.ed'); if (ed) ed.onclick = e => { e.stopPropagation(); openEditor(el.dataset.id); };
  });
  $('pkDone').textContent = pickFromForm ? '선택 완료' : '닫기';
}
function ciRow(c, sel, sub) {
  const editable = c.id !== 'none';
  return '<div class="ci' + (sel ? ' sel' : '') + (sub ? ' sub' : '') + '" data-id="' + esc(c.id) + '">' + (pickFromForm ? '<div class="radio" style="' + (sel ? 'border-color:' + c.c : '') + '"></div>' : '<span class="dot" style="width:10px;height:10px;border-radius:50%;background:' + c.c + '"></span>') + (c.e ? '<span class="em">' + esc(c.e) + '</span>' : '') + '<span class="nm">' + esc(c.n) + '</span>' + (c.def ? '<span class="tag">기본</span>' : '') + (editable ? '<button class="ed" aria-label="편집">✎</button>' : '') + '</div>';
}
let edState = null;
function openEditor(id) {
  if (id) { const c = Cats.get(id); edState = { ...c }; $('edTitle').textContent = '분류 편집'; $('edDel').style.display = 'block'; }
  else { edState = { id: null, t: pickType, n: '', e: '', c: SWATCH[4], p: '', def: false }; $('edTitle').textContent = '새 ' + (pickType === 'income' ? '수입' : '지출') + ' 분류'; $('edDel').style.display = 'none'; }
  $('edEmoji').value = edState.e || ''; $('edName').value = edState.n || ''; $('edDef').checked = !!edState.def;
  $('edQuick').innerHTML = QUICK.map(q => '<button>' + q + '</button>').join('');
  $('edQuick').querySelectorAll('button').forEach(b => b.onclick = () => { $('edEmoji').value = b.textContent; edPrev(); });
  $('edSw').innerHTML = SWATCH.map(c => '<button data-c="' + c + '" style="background:' + c + '" class="' + (c === edState.c ? 'on' : '') + '" aria-label="색상"></button>').join('');
  $('edSw').querySelectorAll('button').forEach(b => b.onclick = () => { edState.c = b.dataset.c; $('edSw').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.c === edState.c)); edPrev(); });
  const hasSubs = edState.id && Cats.subs(edState.id).length;
  const tops = Cats.tops(edState.t).filter(c => c.id !== edState.id);
  $('edParent').innerHTML = '<option value="">없음 (대분류)</option>' + tops.map(c => '<option value="' + esc(c.id) + '"' + (c.id === edState.p ? ' selected' : '') + '>' + esc((c.e ? c.e + ' ' : '') + c.n) + '의 소분류</option>').join('');
  $('edParentWrap').style.display = hasSubs ? 'none' : 'block';
  edPrev(); show('edOv');
}
function edPrev() { $('edPrev').textContent = $('edEmoji').value || '🏷️'; $('edPrev').style.color = edState.c; }
function saveEditor() {
  const n = $('edName').value.trim(); if (!n) { toast('이름을 입력해 주세요'); return; }
  const data = { id: edState.id || 'c' + rid(), t: edState.t, n, e: $('edEmoji').value.trim(), c: edState.c, o: edState.o ?? (Cats.byType(edState.t).length + 1) };
  const p = $('edParentWrap').style.display === 'none' ? '' : $('edParent').value; if (p) data.p = p;
  if ($('edDef').checked) { data.def = true; Cats.byType(edState.t).filter(c => c.def && c.id !== data.id).forEach(c => DB.put('cat', { ...c, def: false })); }
  DB.put('cat', data);
  if (pickFromForm && !edState.id) form.cat = data.id;
  hide('edOv'); renderPicker(); toast('저장됐어요');
}
function delEditor() {
  if (!edState.id || !confirm('이 분류를 삭제할까요?\n소분류도 함께 삭제되고, 기존 내역은 "분류 안 함"으로 보여요.')) return;
  Cats.subs(edState.id).forEach(s => DB.del('cat', s.id)); DB.del('cat', edState.id);
  if (form.cat === edState.id) form.cat = 'none';
  hide('edOv'); renderPicker(); render();
}

/* ===================== 결제 수단 ===================== */
function openPayMgr() { renderPayMgr(); show('payOv'); }
function renderPayMgr() {
  const list = Pays.all();
  $('payList').innerHTML = list.length ? list.map(p => { const a = Accts.get(p.acct); return '<div class="ci" data-id="' + esc(p.id) + '"><span class="em">' + esc(p.e || '💳') + '</span><span class="nm">' + esc(p.n) + (a ? '<small>연결된 자산: ' + esc(a.name) + '</small>' : '') + '</span>' + (p.def ? '<span class="tag">기본</span>' : '') + '<button class="ed" aria-label="편집">✎</button></div>'; }).join('') : '<div class="empty">아직 결제 수단이 없어요</div>';
  $('payList').querySelectorAll('.ci').forEach(el => el.onclick = () => openPayEd(el.dataset.id));
}
let payEd = null;
function openPayEd(id) {
  payEd = id ? { ...Pays.get(id) } : { id: null, n: '', e: '💳', acct: null, def: false };
  $('payEdTitle').textContent = id ? '결제 수단 편집' : '결제 수단 추가';
  $('payEmoji').value = payEd.e || ''; $('payName').value = payEd.n || ''; $('payDef').checked = !!payEd.def;
  $('payQuick').innerHTML = PAY_EMOJI.map(q => '<button>' + q + '</button>').join('');
  $('payQuick').querySelectorAll('button').forEach(b => b.onclick = () => { $('payEmoji').value = b.textContent; });
  $('payAcct').innerHTML = '<option value="">연결 안 함</option>' + Accts.all().map(a => '<option value="' + esc(a.id) + '"' + (a.id === payEd.acct ? ' selected' : '') + '>' + esc((a.emoji ? a.emoji + ' ' : '') + a.name + ' (' + KINDS[a.kind] + ')') + '</option>').join('');
  $('payEdDel').style.display = id ? 'block' : 'none'; show('payEdOv');
}
function savePayEd() {
  const n = $('payName').value.trim(); if (!n) { toast('이름을 입력해 주세요'); return; }
  const data = { id: payEd.id || 'pm' + rid(), n, e: $('payEmoji').value.trim(), o: payEd.o ?? (Pays.all().length + 1) };
  if ($('payAcct').value) data.acct = $('payAcct').value;
  if ($('payDef').checked) { data.def = true; Pays.all().filter(p => p.def && p.id !== data.id).forEach(p => DB.put('pay', { ...p, def: false })); }
  DB.put('pay', data); hide('payEdOv'); renderPayMgr(); toast('저장됐어요');
  if ($('formOv').classList.contains('show') && !payEd.id && form.type === 'expense') { form.pay = data.id; syncForm(); }
}
function delPayEd() { if (payEd.id && confirm('이 결제 수단을 삭제할까요?\n기존 지출 내역은 그대로 남아요.')) { DB.del('pay', payEd.id); if (form.pay === payEd.id) form.pay = null; hide('payEdOv'); renderPayMgr(); } }

/* ===================== 자산 화면 ===================== */
function renderAssets() {
  const b = balances(), { a, d, net } = netWorth(b), list = Accts.all();
  const ne = $('asNet'); ne.textContent = money(net); ne.classList.toggle('neg', net < 0);
  $('asAsset').textContent = money(a); $('asDebt').textContent = money(d);
  $('asLg').textContent = Ledgers.codes().length > 1 ? Ledgers.meta().name : '';
  const html = Object.keys(KINDS).map(k => [k, list.filter(x => x.kind === k)]).filter(g => g[1].length).map(([k, items]) => {
    const sum = items.reduce((s, x) => s + (b[x.id] || 0), 0);
    return '<div class="grp-h"><span>' + KINDS[k] + '</span><span>' + (k === 'debt' ? '-' : '') + money(sum) + '</span></div>' + items.map(x => {
      const pays = Pays.all().filter(p => p.acct === x.id).map(p => p.n);
      return '<div class="arow mrow" data-id="' + esc(x.id) + '"><span class="mi" style="color:' + x.color + '">' + esc(x.emoji || '💰') + '</span><span class="mt"><span>' + esc(x.name) + '</span>' + (pays.length ? '<span class="sub">💳 ' + esc(pays.join(', ')) + '</span>' : '') + '</span><span class="bal num' + (x.kind === 'debt' ? ' ex' : '') + '">' + (x.kind === 'debt' ? '-' : '') + money(b[x.id] || 0) + '</span><span class="chev">›</span></div>';
    }).join('');
  }).join('');
  $('asList').innerHTML = html || '<div class="empty">오른쪽 아래 ＋로 저축 계좌, 입출금 계좌, 현금을 추가해 보세요.</div>';
  $('asList').querySelectorAll('.arow').forEach(el => el.onclick = () => openAcct(el.dataset.id));
}
let acDetId = null;
function openAcct(id) { acDetId = id; renderAcct(); show('acDetOv'); }
function renderAcct() {
  const x = Accts.get(acDetId); if (!x) { hide('acDetOv'); return; }
  const b = balances()[x.id] || 0;
  $('acDetTop').innerHTML = '<div class="em">' + esc(x.emoji || '💰') + '</div><div class="nm">' + esc(x.name) + '</div><div class="kd">' + KINDS[x.kind] + ' · 시작 ' + (x.kind === 'debt' ? '부채 ' : '잔액 ') + money(x.opening || 0) + '</div><div class="big num' + (x.kind === 'debt' ? ' ex' : '') + '">' + (x.kind === 'debt' ? '-' : '') + money(b) + '</div>';
  const today = todayKey(), rows = [], payIds = new Set(Pays.all().filter(p => p.acct === x.id).map(p => p.id));
  for (const t of DB.list('tx')) {
    let delta = 0;
    if (t.type === 'transfer') { if (t.from === x.id) delta -= t.amount + (Number(t.fee) || 0); if (t.to === x.id) delta += t.amount; if (!delta && t.from !== x.id && t.to !== x.id) continue; }
    else if (t.type === 'income') { if (t.acct !== x.id) continue; delta = t.amount; }
    else { if (!(t.acct === x.id || (!t.acct && payIds.has(t.pay)))) continue; delta = -t.amount; }
    if (x.kind === 'debt') delta = -delta;
    for (const k of occDates(t, '0000-00-00', today)) rows.push({ t, k, delta });
  }
  rows.sort((p, q) => q.k.localeCompare(p.k));
  $('acDetList').innerHTML = rows.length ? '<div class="grp-h"><span>최근 내역 (오늘까지)</span><span>' + rows.length + '건</span></div><div class="srch-list">' + rows.slice(0, 300).map(r => txRow(r.t, r.k, { showDate: true, delta: x.kind === 'debt' ? -r.delta : r.delta })).join('') + '</div>' : '<div class="empty">이 자산과 연결된 내역이 아직 없어요.<br>수입의 "입금 계좌", 결제 수단의 "연결된 자산", 이체로 연결할 수 있어요.</div>';
  bindTxRows($('acDetList'));
}
let asEd = null;
function openAssetEditor(id) {
  asEd = id ? { ...Accts.get(id) } : { id: null, name: '', emoji: '🏦', color: '#2f80ed', kind: 'checking', opening: 0 };
  $('asEdTitle').textContent = id ? '자산 편집' : '자산 추가'; $('asEdDel').style.display = id ? 'block' : 'none';
  $('asEmoji').value = asEd.emoji || ''; $('asName').value = asEd.name || '';
  $('asBal').value = asEd.opening ? num(asEd.opening) : '';
  $('asQuick').innerHTML = ASSET_EMOJI.map(q => '<button>' + q + '</button>').join('');
  $('asQuick').querySelectorAll('button').forEach(b => b.onclick = () => { $('asEmoji').value = b.textContent; asEdPrev(); });
  $('asSw').innerHTML = SWATCH.map(c => '<button data-c="' + c + '" style="background:' + c + '" class="' + (c === asEd.color ? 'on' : '') + '" aria-label="색상"></button>').join('');
  $('asSw').querySelectorAll('button').forEach(b => b.onclick = () => { asEd.color = b.dataset.c; $('asSw').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.c === asEd.color)); asEdPrev(); });
  asKind(); asEdPrev(); show('asEdOv');
}
function asKind() { $('asKinds').querySelectorAll('button').forEach(b => b.className = b.dataset.k === asEd.kind ? 'on' : ''); $('asBalLabel').textContent = asEd.kind === 'debt' ? '시작 부채 (갚아야 할 금액)' : '시작 잔액'; }
function asEdPrev() { $('asEdPrev').textContent = $('asEmoji').value || '💰'; $('asEdPrev').style.color = asEd.color; }
function saveAssetEditor() {
  const name = $('asName').value.trim(); if (!name) { toast('이름을 입력해 주세요'); return; }
  const data = { id: asEd.id || 'as' + rid(), name, emoji: $('asEmoji').value.trim(), color: asEd.color, kind: asEd.kind, opening: parseAmt($('asBal').value), o: asEd.o ?? (Accts.all().length + 1) };
  DB.put('acct', data); hide('asEdOv'); renderAssets(); if ($('acDetOv').classList.contains('show')) renderAcct(); render(); toast('저장됐어요');
}
function delAssetEditor() {
  if (!asEd.id) return;
  if (!confirm('이 계좌에 포함된 모든 이체 내역이 삭제되며, 수입 및 지출 내역은 달력에 그대로 남습니다. 삭제하면 복구할 수 없습니다. 삭제하시겠습니까?')) return;
  DB.list('tx').filter(t => t.type === 'transfer' && (t.from === asEd.id || t.to === asEd.id)).forEach(t => DB.del('tx', t.id));
  Pays.all().filter(p => p.acct === asEd.id).forEach(p => { const q = { ...p }; delete q.acct; DB.put('pay', q); });
  DB.del('acct', asEd.id); hide('asEdOv'); hide('acDetOv'); renderAssets(); render();
}

/* ===================== 이체 ===================== */
let trEd = null;
function openTransfer(fromId, editId) {
  const list = Accts.all();
  if (list.length < 2) { toast('이체할 수 있는 계좌가 없습니다. 이체하려면 자산이 2개 이상 있어야 해요.'); return; }
  trEd = editId ? DB.get('tx', editId) : null;
  const opts = sel => list.map(a => '<option value="' + esc(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc((a.emoji ? a.emoji + ' ' : '') + a.name) + '</option>').join('');
  const from = trEd ? trEd.from : (fromId || list[0].id), to = trEd ? trEd.to : (list.find(a => a.id !== from) || list[1]).id;
  $('trFrom').innerHTML = opts(from); $('trTo').innerHTML = opts(to);
  $('trAmt').value = trEd ? num(trEd.amount) : ''; $('trFee').value = trEd && trEd.fee ? num(trEd.fee) : '';
  $('trDate').value = trEd ? trEd.date : todayKey(); $('trMemo').value = trEd ? trEd.memo || '' : '';
  $('trTitle').textContent = trEd ? '이체 편집' : '이체'; $('trSave').textContent = trEd ? '편집 완료' : '이체 기록';
  $('trDel').style.display = trEd ? 'block' : 'none'; show('trOv');
  if (!trEd) setTimeout(() => $('trAmt').focus(), 280);
}
function saveTransfer() {
  const amount = parseAmt($('trAmt').value), from = $('trFrom').value, to = $('trTo').value;
  if (!amount) { toast('금액을 입력해 주세요'); return; }
  if (from === to) { toast('출금 계좌와 입금 계좌가 같아요'); return; }
  const data = { id: trEd ? trEd.id : rid(), type: 'transfer', amount, from, to, fee: parseAmt($('trFee').value), date: $('trDate').value || todayKey(), memo: $('trMemo').value.trim() };
  DB.put('tx', data); hide('trOv'); renderAssets(); if ($('acDetOv').classList.contains('show')) renderAcct(); render(); toast('이체를 기록했어요');
}
function delTransfer() { if (trEd && confirm('이 이체를 삭제할까요?')) { DB.del('tx', trEd.id); hide('trOv'); renderAssets(); if ($('acDetOv').classList.contains('show')) renderAcct(); render(); } }

/* ===================== 월간 요약 ===================== */
let statType = 'expense', statSub = false, statPay = false, statAsc = false;
function openStats() { statPay = false; show('statOv'); renderStats(); }
function periodTitle(y, m) { const { start, end } = period(y, m); return start.getMonth() === end.getMonth() ? start.getFullYear() + '년 ' + (start.getMonth() + 1) + '월' : start.getFullYear() + '. ' + (start.getMonth() + 1) + '. ' + start.getDate() + '. - ' + (end.getMonth() + 1) + '. ' + end.getDate() + '.'; }
function renderStats() {
  const { inc, exp, finc, fexp, items: all } = collect(anchorY, anchorM);
  $('stTitle').textContent = periodTitle(anchorY, anchorM) + ' 요약';
  fillSummary('x_', inc, exp, finc, fexp);
  $('stIn').className = statType === 'income' ? 'on' : ''; $('stEx').className = statType === 'expense' ? 'on' : '';
  $('stKind').textContent = '전체 ' + (statType === 'expense' ? '지출' : '수입') + ' · 항목을 누르면 상세 내역';
  $('stSub').className = 'pill' + (statSub ? ' on' : ''); $('stPay').className = 'pill' + (statPay ? ' on' : '');
  $('stPay').style.display = statType === 'expense' ? '' : 'none';
  $('stSort').textContent = statAsc ? '금액 낮은 순' : '금액 높은 순';
  const items = all.filter(x => x.t.type === statType), total = items.reduce((s, x) => s + x.t.amount, 0), body = $('stBody');
  if (!items.length) { body.innerHTML = '<div class="empty">수입과 지출을 기록하시면 금액이 높은 순서대로 보여드려요 📊</div>'; return; }
  const sorter = (a, b) => statAsc ? a.amt - b.amt : b.amt - a.amt;
  if (statPay && statType === 'expense') {
    const g = {}; items.forEach(x => { const k = x.t.pay && Pays.get(x.t.pay) ? x.t.pay : 'none'; (g[k] = g[k] || []).push(x); });
    const rows = Object.entries(g).map(([k, v]) => { const p = Pays.get(k); return { key: k, n: p ? p.n : '선택 안 함', e: p ? p.e : '', c: '#5b63d8', amt: v.reduce((s, x) => s + x.t.amount, 0), list: v }; }).sort(sorter);
    const max = Math.max(...rows.map(r => r.amt)) || 1;
    body.innerHTML = rows.map((r, i) => '<div class="crow" data-i="' + i + '">' + barInner(r, total, max) + '</div>').join('');
    body.querySelectorAll('.crow').forEach(el => el.onclick = () => { const r = rows[el.dataset.i]; openDrill('💳 ' + r.n, r.list); });
    return;
  }
  const groups = {};
  items.forEach(x => { const top = Cats.top(x.t.cat).id; const g = (groups[top] = groups[top] || { amt: 0, subs: {}, list: [] }); g.amt += x.t.amount; g.list.push(x); const c = Cats.get(x.t.cat); const sk = c.id !== top ? c.id : '_self'; (g.subs[sk] = g.subs[sk] || { amt: 0, list: [] }); g.subs[sk].amt += x.t.amount; g.subs[sk].list.push(x); });
  const rows = Object.entries(groups).map(([k, v]) => ({ ...Cats.get(k), key: k, ...v })).sort(sorter);
  const max = Math.max(...rows.map(r => r.amt)) || 1;
  body.innerHTML = rows.map((r, i) => {
    let h = '<div class="crow" data-i="' + i + '">' + barInner(r, total, max);
    if (statSub) {
      const subs = Object.entries(r.subs).filter(([k]) => k !== '_self');
      if (subs.length) { const sr = subs.map(([k, v]) => ({ ...Cats.get(k), key: k, ...v })).sort(sorter); const sm = Math.max(...sr.map(s => s.amt)) || 1; h += '<div class="subs">' + sr.map(s => '<div class="crow sub" data-i="' + i + '" data-s="' + esc(s.key) + '">' + barInner(s, r.amt, sm, true) + '</div>').join('') + '</div>'; }
    }
    return h + '</div>';
  }).join('');
  body.querySelectorAll('.crow').forEach(el => el.onclick = e => {
    e.stopPropagation(); const r = rows[el.dataset.i];
    if (el.dataset.s) { const s = r.subs[el.dataset.s]; openDrill(catLabel(el.dataset.s), s.list); } else openDrill(catLabel(r.key), r.list);
  });
}
function barInner(r, total, max, sub) {
  const pct = total ? Math.round(r.amt / total * 100) : 0, w = Math.max(3, Math.round(r.amt / max * 100));
  return '<div class="top"><span>' + (sub ? '' : '<b>') + esc((r.e ? r.e + ' ' : '') + r.n) + (sub ? '' : '</b>') + '</span><span class="num">' + money(r.amt) + ' <span class="pct">' + pct + '%</span></span></div><div class="bar" style="width:' + w + '%;background:' + (r.c || '#5b63d8') + ';' + (sub ? 'opacity:.8' : '') + '"></div>';
}

/* ===================== 상세 내역 목록 ===================== */
let drItems = [], drByAmt = false;
function openDrill(title, items) { drItems = items; drByAmt = false; $('drTitle').textContent = title; renderDrill(); show('drillOv'); }
function renderDrill() {
  const list = drItems.slice().sort((a, b) => drByAmt ? b.t.amount - a.t.amount : b.key.localeCompare(a.key));
  $('drSort').textContent = drByAmt ? '금액 높은 순' : '최신순';
  $('drSum').textContent = list.length + '건 · ' + money(list.reduce((s, x) => s + x.t.amount, 0));
  $('drList').innerHTML = list.map(x => txRow(x.t, x.key, { showDate: true })).join('') || '<div class="empty">기록이 없습니다</div>';
  bindTxRows($('drList'));
}
function refreshOpenSheets() {
  if ($('statOv').classList.contains('show')) renderStats();
  if ($('drillOv').classList.contains('show')) { const keys = new Set(drItems.map(x => x.t.id)); drItems = drItems.map(x => ({ t: DB.get('tx', x.t.id), key: x.key })).filter(x => x.t && occurs(x.t, x.key) && keys.has(x.t.id)); renderDrill(); }
  if ($('srchOv').classList.contains('show')) runSearch();
  if ($('acDetOv').classList.contains('show')) renderAcct();
  if ($('assetPane').classList.contains('on')) renderAssets();
  if ($('trendPane').classList.contains('on')) renderTrends();
}

/* ===================== 추세 ===================== */
let trY = new Date().getFullYear(), trCat = '';
function renderTrends() {
  $('trYear').textContent = trY + '년';
  $('trLg').textContent = Ledgers.codes().length > 1 ? Ledgers.meta().name : '';
  const ex = Cats.tops('expense'), inc = Cats.tops('income');
  if (trCat && !Cats.all().find(c => c.id === trCat)) trCat = '';
  $('trCat').innerHTML = '<option value="">전체 (수입 · 지출)</option><optgroup label="지출 분류">' + ex.map(c => '<option value="' + esc(c.id) + '">' + esc((c.e ? c.e + ' ' : '') + c.n) + '</option>').join('') + '</optgroup><optgroup label="수입 분류">' + inc.map(c => '<option value="' + esc(c.id) + '">' + esc((c.e ? c.e + ' ' : '') + c.n) + '</option>').join('') + '</optgroup>';
  $('trCat').value = trCat;
  const catT = trCat ? Cats.get(trCat).t : null;
  const months = [];
  for (let m = 0; m < 12; m++) {
    const c = collect(trY, m);
    if (trCat) { const v = c.items.filter(x => Cats.top(x.t.cat).id === trCat).reduce((s, x) => s + x.t.amount, 0); months.push({ m, in: catT === 'income' ? v : 0, ex: catT === 'expense' ? v : 0 }); }
    else months.push({ m, in: c.inc + c.finc, ex: c.exp + c.fexp });
  }
  const max = Math.max(1, ...months.map(x => Math.max(x.in, x.ex)));
  const now = new Date(), curM = now.getFullYear() === trY ? now.getMonth() : -1;
  const cc = trCat ? Cats.get(trCat).c : null;
  $('trLegend').innerHTML = trCat ? '<span><i style="background:' + cc + '"></i>' + esc(Cats.get(trCat).n) + '</span>' : '<span><i style="background:var(--in)"></i>수입</span><span><i style="background:var(--ex)"></i>지출</span>';
  $('trChart').innerHTML = months.map(x => '<div class="tr-col' + (x.m === curM ? ' cur' : '') + '" data-m="' + x.m + '"><div class="tr-bars">' + (trCat ? '<i style="height:' + (x.in + x.ex) / max * 100 + '%;background:' + cc + ';width:60%"></i>' : '<i style="height:' + x.in / max * 100 + '%;background:var(--in)"></i><i style="height:' + x.ex / max * 100 + '%;background:var(--ex)"></i>') + '</div><div class="ml">' + (x.m + 1) + '월</div></div>').join('');
  const sIn = months.reduce((s, x) => s + x.in, 0), sEx = months.reduce((s, x) => s + x.ex, 0);
  const active = months.filter(x => x.in || x.ex).length || 1;
  $('trSum').innerHTML = trCat
    ? '<div><div class="lbl">' + trY + '년 합계</div><div class="num ' + (catT === 'income' ? 'in' : 'ex') + '">' + money(sIn + sEx) + '</div></div><div><div class="lbl">기록한 달 평균</div><div class="num">' + money((sIn + sEx) / active) + '</div></div>'
    : '<div><div class="lbl">연간 수입</div><div class="num in">' + money(sIn) + '</div></div><div><div class="lbl">연간 지출</div><div class="num ex">' + money(sEx) + '</div></div><div><div class="lbl">연간 합계</div><div class="num">' + money(sIn - sEx) + '</div></div><div><div class="lbl">기록한 달 평균 지출</div><div class="num">' + money(sEx / active) + '</div></div>';
  $('trList').innerHTML = '<div class="mrow trm head"><span>월</span><span class="num">수입</span><span class="num">지출</span><span class="num">합계</span></div>' + months.slice().reverse().map(x => '<div class="mrow trm" data-m="' + x.m + '"><span class="m">' + (x.m + 1) + '월</span><span class="num" style="color:var(--in)">' + (x.in ? money(x.in) : '-') + '</span><span class="num" style="color:var(--ex)">' + (x.ex ? money(x.ex) : '-') + '</span><span class="num">' + ((x.in || x.ex) ? money(x.in - x.ex) : '-') + '</span></div>').join('');
  document.querySelectorAll('#trChart .tr-col, #trList .mrow[data-m]').forEach(el => el.onclick = () => { anchorY = trY; anchorM = Number(el.dataset.m); switchTab('cal'); render(); });
}

/* ===================== 월 선택 / 검색 ===================== */
let mpY;
function openMonthPicker() { mpY = anchorY; renderMP(); show('mpOv'); }
function renderMP() {
  $('mpYear').textContent = mpY + '년'; const g = $('mpGrid'); g.innerHTML = '';
  for (let i = 0; i < 12; i++) { const b = document.createElement('button'); b.textContent = (i + 1) + '월'; if (mpY === anchorY && i === anchorM) b.className = 'on'; b.onclick = () => { anchorY = mpY; anchorM = i; hide('mpOv'); render(); }; g.appendChild(b); }
}
function openSearch() { $('srchInput').value = ''; $('srchList').innerHTML = ''; $('srchSum').textContent = '검색어를 입력하거나 기간을 정해 보세요.'; show('srchOv'); setTimeout(() => $('srchInput').focus(), 250); }
function runSearch() {
  const q = $('srchInput').value.trim().toLowerCase(), from = $('srchFrom').value, to = $('srchTo').value, sort = $('srchSort').value, list = $('srchList');
  if (!q && !from && !to) { list.innerHTML = ''; $('srchSum').textContent = '검색어를 입력하거나 기간을 정해 보세요.'; return; }
  const a = from || '0000-00-00', b = to || (q ? '9999-12-31' : todayKey()), recCap = to || todayKey();
  const res = [];
  for (const t of DB.list('tx')) {
    if (t.type === 'transfer') continue;
    if (q) { const p = Pays.get(t.pay), ac = Accts.get(t.acct); const hay = [t.memo, catLabel(t.cat), p && p.n, ac && ac.name].join(' ').toLowerCase(); if (!hay.includes(q)) continue; }
    for (const k of occDates(t, a, t.rec ? (b < recCap ? b : recCap) : b)) res.push({ t, key: k });
  }
  const s = { new: (x, y) => y.key.localeCompare(x.key), old: (x, y) => x.key.localeCompare(y.key), high: (x, y) => y.t.amount - x.t.amount, low: (x, y) => x.t.amount - y.t.amount }[sort];
  res.sort(s);
  const si = res.filter(x => x.t.type === 'income').reduce((v, x) => v + x.t.amount, 0), se = res.filter(x => x.t.type === 'expense').reduce((v, x) => v + x.t.amount, 0);
  $('srchSum').textContent = res.length ? res.length + '건 · 수입 ' + money(si) + ' · 지출 ' + money(se) + (!to ? ' (반복 내역은 오늘까지)' : '') : '';
  list.innerHTML = res.length ? res.slice(0, 500).map(x => txRow(x.t, x.key, { showDate: true })).join('') : '<div class="empty">검색 결과가 없습니다. 다른 검색어로 검색해 보시면 어떨까요? 🙏</div>';
  bindTxRows(list);
}

/* ===================== 가계부 관리 ===================== */
function openLedger() { renderLedger(); show('ledgerOv'); }
function renderLedger() {
  const codes = Ledgers.codes(), metas = codes.map(c => ({ code: c, ...Ledgers.meta(c) }));
  const row = l => '<div class="ci' + (l.code === activeLedger ? ' sel' : '') + '" data-code="' + esc(l.code) + '"><div class="radio"></div><span class="nm">' + esc(l.name) + (l.shared ? ' 👥' : '') + '<small>' + esc(l.currency) + ' · 시작일 ' + (l.startDay || 1) + '일</small></span><button class="ed" aria-label="편집">✎</button></div>';
  const per = metas.filter(l => !l.shared), sh = metas.filter(l => l.shared);
  $('ledgerBody').innerHTML = '<div class="clist"><div class="grp-h" style="padding-left:4px">개인 가계부</div>' + per.map(row).join('') +
    '<div class="grp-h" style="padding-left:4px;margin-top:6px">공유 가계부</div>' + (sh.length ? sh.map(row).join('') : '<div class="pk-desc" style="padding:4px 4px 8px">가족처럼 다른 사람과 함께 쓰는 가계부예요. 아래에서 만들거나, 받은 코드로 참여하세요.</div>') +
    '</div><div style="padding:6px 16px 24px"><button class="pbtn sec" id="lgAddP">＋ 개인 가계부 추가</button><button class="pbtn pri" id="lgCreate">＋ 공유 가계부 만들기</button><button class="pbtn sec" id="lgJoin">코드로 공유 가계부 참여</button><div class="guide" style="margin-top:12px">같은 계정으로 로그인한 아이폰·맥 사이에는 개인 가계부와 공유 가계부 모두 자동으로 동기화돼요.</div></div>';
  $('ledgerBody').querySelectorAll('.ci').forEach(el => {
    el.onclick = () => { setActive(el.dataset.code); hide('ledgerOv'); };
    el.querySelector('.ed').onclick = e => { e.stopPropagation(); openLgEd(el.dataset.code); };
  });
  $('lgAddP').onclick = addPersonal; $('lgCreate').onclick = createShared; $('lgJoin').onclick = joinShared;
}
function addPersonal() {
  const name = (prompt('새 개인 가계부 이름', '여행 가계부') || '').trim(); if (!name) return;
  const code = 'l_' + rcode(16); seedLedger(code, { name, shared: false }); Ledgers.add(code); setActive(code); renderLedger(); toast('「' + name + '」을 만들었어요');
}
async function createShared() {
  if (!sbUser) { alert('다른 사람과 공유하려면 먼저 클라우드 동기화에 로그인해야 해요.'); hide('ledgerOv'); openSync(); return; }
  const name = (prompt('공유 가계부 이름', '가족 가계부') || '').trim(); if (!name) return;
  const code = rcode(8);
  try {
    const { error } = await sb.from('ledger_members').insert([{ code, user_id: sbUser.id, name }]); if (error) throw error;
    const names = gS('lgNames', {}); names[code] = name; sS('lgNames', names); sS('srvCodes', [...new Set([...gS('srvCodes', []), code])]);
    seedLedger(code, { name, shared: true }); Ledgers.add(code); setActive(code); renderLedger(); Sync.schedule();
    setTimeout(() => alert('「' + name + '」을 만들었어요!\n\n참여 코드:  ' + code + '\n\n함께 쓸 사람에게 이 코드를 알려주세요. (✎ 편집 화면에서 다시 볼 수 있어요)'), 150);
  } catch (e) { alert('오류: ' + (e.message || e)); }
}
async function joinShared() {
  if (!sbUser) { alert('참여하려면 먼저 클라우드 동기화에 로그인해야 해요.'); hide('ledgerOv'); openSync(); return; }
  const code = (prompt('참여 코드를 입력하세요 (예: ABC23XYZ)') || '').trim().toUpperCase(); if (!code) return;
  if (code.startsWith('P_') || code.startsWith('L_')) { alert('공유 가계부 코드가 아니에요.'); return; }
  try {
    const { error } = await sb.from('ledger_members').insert([{ code, user_id: sbUser.id, name: '공유 가계부' }]); if (error && error.code !== '23505') throw error;
    Ledgers.add(code); sS('srvCodes', [...new Set([...gS('srvCodes', []), code])]);
    await Sync.pull(code); await legacyImport(code);
    if (!DB.list('cat', code).length) seedLedger(code, { name: Ledgers.meta(code).name, shared: true }, 0);
    setActive(code); renderLedger(); toast('참여 완료!');
  } catch (e) { alert('오류: ' + (e.message || e)); }
}
let lgEdCode = null;
function openLgEd(code) {
  lgEdCode = code; const m = Ledgers.meta(code);
  $('lgName2').value = m.name; $('lgCur').innerHTML = CURRENCIES.map(([c, n]) => '<option value="' + c + '"' + (c === m.currency ? ' selected' : '') + '>' + n + ' (' + c + ' · ' + symOf(c) + ')</option>').join('');
  $('lgStart').innerHTML = Array.from({ length: 28 }, (_, i) => '<option value="' + (i + 1) + '"' + (i + 1 === Number(m.startDay || 1) ? ' selected' : '') + '>' + (i + 1) + '일</option>').join('');
  $('lgCodeWrap').style.display = m.shared ? 'block' : 'none'; $('lgCode').textContent = code;
  const isDef = code === Ledgers.def();
  $('lgDel').style.display = isDef ? 'none' : 'block'; $('lgDel').textContent = m.shared ? '이 공유 가계부에서 나가기' : '이 가계부 삭제';
  show('lgEdOv');
}
function saveLgEd() {
  const name = $('lgName2').value.trim(); if (!name) { toast('이름을 입력해 주세요'); return; }
  Ledgers.setMeta({ name, currency: $('lgCur').value, startDay: Number($('lgStart').value) }, lgEdCode);
  hide('lgEdOv'); if (lgEdCode === activeLedger) anchorToToday(); renderLedger(); rerenderAll(); toast('저장됐어요');
}
async function delLgEd() {
  const code = lgEdCode, m = Ledgers.meta(code);
  if (m.shared) {
    if (!confirm('「' + m.name + '」에서 나갈까요?\n다른 사람의 데이터는 그대로 남고, 코드로 다시 참여할 수 있어요.')) return;
    if (sbUser) { const { error } = await sb.from('ledger_members').delete().eq('code', code).eq('user_id', sbUser.id); if (error) { alert('오류: ' + error.message); return; } }
  } else {
    if (!confirm('「' + m.name + '」과 그 안의 모든 내역을 삭제할까요?\n삭제하면 복구할 수 없습니다.')) return;
    for (const it of Object.values(DB.map)) if (it.ledger === code && !it.deleted) { it.deleted = true; it.updated_at = Date.now(); it.dirty = true; }
    DB.touch();
    if (sbUser) { try { await Sync.push(); await sb.from('ledger_members').delete().eq('code', code).eq('user_id', sbUser.id); } catch (e) { console.warn(e); } }
  }
  dropLocal(code); sS('srvCodes', gS('srvCodes', []).filter(c => c !== code));
  hide('lgEdOv'); renderLedger(); toast('정리했어요');
}
function dropLocal(code) {
  for (const k of Object.keys(DB.map)) if (DB.map[k].ledger === code) delete DB.map[k];
  DB.touch(); Ledgers.remove(code); if (activeLedger === code) setActive(Ledgers.codes()[0]);
}

/* ===================== 더보기 ===================== */
function refreshMore() {
  const m = Ledgers.meta();
  $('ledgerVal').textContent = m.name; $('startDayVal').textContent = startDay() + '일'; $('currencyVal').textContent = m.currency + ' (' + symOf(m.currency) + ')';
  $('syncVal').textContent = sbUser ? (Sync.needSql ? '설정 필요' : '켜짐') : '꺼짐';
  $('themeVal').textContent = { system: '시스템 설정', light: '라이트 모드', dark: '다크 모드' }[gS('theme', 'system')];
}
function openStartDay() {
  const g = $('startGrid'); g.innerHTML = '';
  for (let i = 1; i <= 28; i++) { const b = document.createElement('button'); b.textContent = i; if (i === startDay()) b.className = 'on'; b.onclick = () => { Ledgers.setMeta({ startDay: i }); hide('startOv'); anchorToToday(); refreshMore(); render(); toast('달력 시작일: ' + i + '일'); }; g.appendChild(b); }
  show('startOv');
}
async function chooseCurrency() {
  const m = Ledgers.meta();
  const v = await pick('통화 — ' + m.name, CURRENCIES.map(([c, n]) => ({ id: c, label: n + ' (' + symOf(c) + ')', sub: c })), m.currency, '가계부마다 통화를 따로 정할 수 있어요. 이미 적은 금액의 숫자는 그대로 두고 표시만 바뀌어요.');
  if (!v) return; Ledgers.setMeta({ currency: v }); rerenderAll(); toast('통화: ' + v);
}
async function chooseTheme() {
  const v = await pick('스타일', [{ id: 'system', label: '시스템 설정', em: '⚙️' }, { id: 'light', label: '라이트 모드', em: '☀️' }, { id: 'dark', label: '다크 모드', em: '🌙' }], gS('theme', 'system'));
  if (!v) return; sS('theme', v); applyTheme(); refreshMore();
}
const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const t = gS('theme', gS('dark', false) ? 'dark' : 'system');
  const dark = t === 'dark' || (t === 'system' && darkMQ && darkMQ.matches);
  document.body.classList.toggle('dark', dark);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0c0d10' : '#f3f4f7';
}
if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme);

/* ===================== 내보내기 / 백업 ===================== */
async function deliverFile(name, blob, mime) {
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare && /iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function exportCSV() {
  const m = Ledgers.meta(), today = todayKey(), rows = [];
  for (const t of DB.list('tx')) {
    for (const k of occDates(t, '0000-00-00', t.rec ? today : '9999-12-31')) {
      if (t.type === 'transfer') { const f = Accts.get(t.from), to = Accts.get(t.to); rows.push([k, '이체', '', '', t.amount, (f ? f.name : '') + ' → ' + (to ? to.name : ''), [t.fee ? '수수료 ' + t.fee : '', t.memo].filter(Boolean).join(' / '), '']); continue; }
      const c = Cats.get(t.cat), top = Cats.top(t.cat), p = Pays.get(t.pay), a = Accts.get(txAcct(t));
      rows.push([k, t.type === 'income' ? '수입' : '지출', top.id === 'none' ? '' : top.n, c.id !== top.id ? c.n : '', t.amount, [p && p.n, a && a.name].filter(Boolean).join(' / '), t.memo || '', t.rec ? repText(t.rec.f, t.date) : '']);
    }
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const head = ['날짜', '구분', '분류', '소분류', '금액(' + m.currency + ')', '결제 수단 / 계좌', '메모', '반복'];
  const csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  await deliverFile('가계부_' + m.name.replace(/[\\/:*?"<>|\s]+/g, '_') + '_' + today + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'text/csv');
  toast(rows.length + '건을 내보냈어요 (반복 내역은 오늘까지)');
}
async function exportBackup() {
  const data = { app: 'yurim-budget', v: 3, at: new Date().toISOString(), defCode: Ledgers.def(), ledgers: Ledgers.codes(), names: gS('lgNames', {}), items: Object.values(DB.map).filter(it => !it.deleted).map(({ dirty, ...it }) => it) };
  await deliverFile('가계부_백업_' + todayKey() + '.json', new Blob([JSON.stringify(data)], { type: 'application/json' }), 'application/json');
  toast('백업 파일을 만들었어요');
}
function restoreBackup(file) {
  const r = new FileReader();
  r.onload = () => {
    let d; try { d = JSON.parse(r.result); } catch (e) { alert('백업 파일을 읽을 수 없어요.'); return; }
    if (d && d.v === 3 && Array.isArray(d.items)) {
      if (!confirm('백업 파일의 ' + d.items.length + '개 항목을 지금 기기의 데이터와 합칠까요?\n· 그 사이 지운 항목은 되살려요\n· 양쪽에 다 있는 항목은 더 최근에 고친 쪽이 남아요')) return;
      const def = Ledgers.def(), map = c => c === d.defCode ? def : c; let n = 0;
      for (const it of d.items) {
        const lg = map(it.ledger), id = DB.k(it.kind, lg, it.data.id), l = DB.map[id];
        if (!l || l.deleted) { DB.map[id] = { id, kind: it.kind, ledger: lg, data: it.data, updated_at: l ? Date.now() : it.updated_at, deleted: false, dirty: true }; n++; }
        else if (l.updated_at < it.updated_at) { DB.map[id] = { id, kind: it.kind, ledger: lg, data: it.data, updated_at: it.updated_at, deleted: false, dirty: true }; n++; }
        Ledgers.add(lg);
      }
      const names = { ...(d.names || {}), ...gS('lgNames', {}) }; sS('lgNames', names);
      DB.touch(); Sync.schedule(); rerenderAll(); toast(n + '개 항목을 불러왔어요');
    } else if (d && Array.isArray(d.tx)) {
      if (!confirm('예전 버전 백업이에요. 내역 ' + d.tx.length + '건을 지금 가계부에 불러올까요?')) return;
      (d.cats || []).forEach((c, i) => { if (!DB.get('cat', c.id)) DB.put('cat', { ...c, o: c.o ?? i }, activeLedger, Date.now()); });
      d.tx.forEach(t => { const x = v2tx(t); if (!DB.get('tx', x.id)) DB.put('tx', x, activeLedger, Date.now()); });
      DB.touch(); Sync.schedule(); rerenderAll(); toast('불러왔어요');
    } else alert('이 앱의 백업 파일이 아니에요.');
  };
  r.readAsText(file);
}

/* ===================== 예전 버전(v2) 데이터 옮기기 ===================== */
function v2tx(t) { const x = { id: String(t.id), type: t.type === 'income' ? 'income' : 'expense', amount: Number(t.amount) || 0, date: t.date || '2000-01-01', cat: t.cat || 'none', memo: t.memo || '' }; if (t.fixed) x.rec = { f: 'monthly' }; return x; }
function migrateV2() {
  if (gS('migrated3', false)) return;
  const L = 'local', T = 0;
  const oldTx = rawGet('yunseul_v2') || [], oldCats = rawGet('ys_cats'), oldAssets = rawGet('ys_assets'), oldLedgers = rawGet('ys_ledgers') || [];
  const oldStart = gS('startDay', 1), oldActive = gS('active', 'personal');
  const cats = Array.isArray(oldCats) ? oldCats : DEFAULT_CATS;
  const lgs = [L, ...oldLedgers.filter(l => l.shared && l.code).map(l => l.code)];
  const names = gS('lgNames', {});
  for (const lg of lgs) {
    const shared = lg !== L, nm = shared ? (oldLedgers.find(l => l.code === lg) || {}).name || '공유 가계부' : '기본 가계부';
    if (shared) names[lg] = nm;
    DB.put('meta', { id: 'meta', name: nm, currency: 'KRW', startDay: shared ? 1 : oldStart, shared }, lg, T);
    cats.forEach((c, i) => DB.put('cat', { ...c, o: i }, lg, T));
    DEFAULT_PAYS.forEach((p, i) => DB.put('pay', { ...p, o: i }, lg, T));
  }
  const accts = Array.isArray(oldAssets) ? oldAssets.map((a, i) => ({ id: a.id, name: a.name, emoji: a.emoji, color: a.color, kind: a.kind === 'debt' ? 'debt' : a.id === 'a_cash' ? 'cash' : a.id === 'a_save' ? 'savings' : 'checking', opening: Number(a.balance) || 0, o: i })) : DEFAULT_ACCTS.map((a, i) => ({ ...a, o: i }));
  accts.forEach(a => DB.put('acct', a, L, T));
  if (!accts.find(a => a.id === 'a_cash')) DB.put('pay', { ...DEFAULT_PAYS[1], acct: undefined }, L, T);
  for (const t of oldTx) { const lg = !t.ledger || t.ledger === 'personal' ? L : t.ledger; if (!lgs.includes(lg)) continue; DB.put('tx', v2tx(t), lg, T); }
  sS('lgNames', names); sS('ledgers3', lgs); sS('defCode', L);
  activeLedger = oldActive === 'personal' || !lgs.includes(oldActive) ? L : oldActive; sS('active3', activeLedger);
  if (gS('dark', false) && gS('theme', null) === null) sS('theme', 'dark');
  DB.touch(); sS('migrated3', true);
}

/* ===================== 동기화 (Supabase) ===================== */
let sb = null, sbUser = null;
const SQL_TEXT = `-- 유림 가계부 v3 설정 (여러 번 실행해도 안전해요)
-- 1) 가계부 참여자 표
create table if not exists ledger_members (
  code text not null,
  user_id uuid not null default auth.uid(),
  name text,
  created_at timestamptz default now(),
  primary key (code, user_id)
);
alter table ledger_members enable row level security;
drop policy if exists m_own on ledger_members;
create policy m_own on ledger_members for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and (code not like 'p\\_%' or code = 'p_' || auth.uid()::text));

-- 2) 모든 데이터(내역·분류·자산·결제 수단·설정)를 담는 표
create table if not exists ys_items (
  id text primary key,
  ledger text not null,
  kind text not null,
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  user_id uuid default auth.uid(),
  server_ts timestamptz not null default now()
);
create index if not exists ys_items_ts on ys_items (server_ts);
create index if not exists ys_items_ledger on ys_items (ledger);
alter table ys_items enable row level security;
drop policy if exists items_access on ys_items;
create policy items_access on ys_items for all
  using (exists (select 1 from ledger_members m
    where m.code = ys_items.ledger and m.user_id = auth.uid()))
  with check (exists (select 1 from ledger_members m
    where m.code = ys_items.ledger and m.user_id = auth.uid()));

-- 3) 더 오래된 수정이 최신 내용을 덮어쓰지 않도록 막기
create or replace function ys_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.server_ts := now();
  return new;
end $$;
drop trigger if exists ys_touch on ys_items;
create trigger ys_touch before insert or update on ys_items
  for each row execute function ys_touch();

-- 4) 위젯·단축어 전용 통로: "연결 코드" 하나로 읽기 + 내역 추가만 가능
create table if not exists ys_keys (
  user_id uuid primary key,
  key_hash text not null,
  created_at timestamptz default now()
);
alter table ys_keys enable row level security;

create or replace function ys_key_create() returns text
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into ys_keys (user_id, key_hash)
    values (auth.uid(), encode(sha256(convert_to(k, 'UTF8')), 'hex'))
    on conflict (user_id) do update set key_hash = excluded.key_hash, created_at = now();
  return k;
end $$;

create or replace function ys_key_revoke() returns void
language sql security definer set search_path = public as $$
  delete from ys_keys where user_id = auth.uid();
$$;

create or replace function ys_w_user(p_key text) returns uuid
language plpgsql security definer set search_path = public stable as $$
declare uid uuid;
begin
  select user_id into uid from ys_keys
    where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  if uid is null then raise exception '연결 코드가 맞지 않아요. 앱에서 새로 만들어 주세요.'; end if;
  return uid;
end $$;

create or replace function ys_w_ledger(p_uid uuid, p_ledger text) returns text
language plpgsql security definer set search_path = public stable as $$
declare lg text := coalesce(nullif(trim(p_ledger), ''), 'p_' || p_uid::text);
begin
  if exists (select 1 from ledger_members where code = lg and user_id = p_uid) then return lg; end if;
  select m.code into lg from ledger_members m
    join ys_items i on i.ledger = m.code and i.kind = 'meta' and not i.deleted
    where m.user_id = p_uid and i.data->>'name' = trim(p_ledger) limit 1;
  if lg is null then raise exception '「%」 가계부를 찾을 수 없어요', p_ledger; end if;
  return lg;
end $$;

create or replace function ys_w_catlist(p_ledger text, p_type text)
returns table (id text, label text)
language sql security definer set search_path = public stable as $$
  select c.data->>'id',
         case when p.data is not null
           then coalesce(nullif(p.data->>'e', '') || ' ', '') || (p.data->>'n') || ' › ' || (c.data->>'n')
           else coalesce(nullif(c.data->>'e', '') || ' ', '') || (c.data->>'n') end
  from ys_items c
  left join ys_items p on p.ledger = c.ledger and p.kind = 'cat' and not p.deleted
    and p.data->>'id' = c.data->>'p'
  where c.ledger = p_ledger and c.kind = 'cat' and not c.deleted and c.data->>'t' = p_type
  order by coalesce((coalesce(p.data, c.data)->>'o')::numeric, 999),
           coalesce(p.data, c.data)->>'n',
           case when p.data is null then -1 else coalesce((c.data->>'o')::numeric, 999) end;
$$;

create or replace function ys_w_items(p_key text, p_ledger text default null) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare uid uuid := ys_w_user(p_key); lg text := ys_w_ledger(uid, p_ledger);
begin
  return jsonb_build_object('ledger', lg, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('k', kind, 'd', data))
    from ys_items where ledger = lg and not deleted
      and kind in ('meta', 'cat', 'tx', 'acct', 'pay')), '[]'::jsonb));
end $$;

create or replace function ys_w_cats(p_key text, p_type text default 'expense', p_ledger text default null)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare uid uuid := ys_w_user(p_key); lg text := ys_w_ledger(uid, p_ledger);
begin
  return coalesce((select jsonb_agg(label) from ys_w_catlist(lg, p_type)), '[]'::jsonb)
    || '["분류 안 함"]'::jsonb;
end $$;

create or replace function ys_w_add(p_key text, p_amount text, p_type text default 'expense',
  p_cat text default null, p_memo text default null, p_pay text default null,
  p_date text default null, p_ledger text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := ys_w_user(p_key); lg text := ys_w_ledger(uid, p_ledger);
  amt numeric; d date; cid text; clabel text; pid text; txid text; ms bigint; doc jsonb;
begin
  if p_type not in ('expense', 'income') then raise exception '구분은 expense 또는 income 이어야 해요'; end if;
  begin
    amt := round(replace(replace(coalesce(p_amount, ''), ',', ''), ' ', '')::numeric, 2);
  exception when others then raise exception '금액을 숫자로 입력해 주세요';
  end;
  if amt is null or amt <= 0 then raise exception '금액을 입력해 주세요'; end if;
  d := coalesce(nullif(trim(p_date), '')::date, (now() at time zone 'Asia/Seoul')::date);

  select l.id, l.label into cid, clabel from ys_w_catlist(lg, p_type) l
    where l.label = trim(p_cat) limit 1;
  if cid is null and nullif(trim(p_cat), '') is not null then
    select l.id, l.label into cid, clabel from ys_w_catlist(lg, p_type) l
      where l.label like '%' || trim(p_cat) limit 1;
  end if;
  if cid is null and nullif(trim(p_cat), '') is null then
    select l.id, l.label into cid, clabel from ys_w_catlist(lg, p_type) l
      join ys_items c on c.ledger = lg and c.kind = 'cat' and c.data->>'id' = l.id
      where (c.data->>'def')::boolean limit 1;
  end if;
  cid := coalesce(cid, 'none'); clabel := coalesce(clabel, '분류 안 함');

  if p_type = 'expense' then
    select data->>'id' into pid from ys_items
      where ledger = lg and kind = 'pay' and not deleted
        and (data->>'n' = trim(p_pay) or coalesce(nullif(data->>'e', '') || ' ', '') || (data->>'n') = trim(p_pay))
      limit 1;
    if pid is null and nullif(trim(p_pay), '') is null then
      select data->>'id' into pid from ys_items
        where ledger = lg and kind = 'pay' and not deleted and (data->>'def')::boolean limit 1;
    end if;
  end if;

  ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  txid := 'w' || ms::text || substr(md5(random()::text), 1, 4);
  doc := jsonb_strip_nulls(jsonb_build_object('id', txid, 'type', p_type, 'amount', amt,
    'date', to_char(d, 'YYYY-MM-DD'), 'cat', cid, 'memo', coalesce(trim(p_memo), ''), 'pay', pid));
  insert into ys_items (id, ledger, kind, data, updated_at, deleted, user_id)
    values ('tx:' || lg || ':' || txid, lg, 'tx', doc, ms, false, uid);
  return jsonb_build_object('ok', true, 'id', txid,
    'message', clabel || ' ' || rtrim(to_char(amt, 'FM999,999,999,990.99'), '.') || ' 기록했어요');
end $$;

revoke all on function ys_w_user(text) from public, anon, authenticated;
revoke all on function ys_w_ledger(uuid, text) from public, anon, authenticated;
revoke all on function ys_w_catlist(text, text) from public, anon, authenticated;`;
function sbCfg() { return rawGet('yunseul_sb'); }
function initSb() { const c = sbCfg(); if (c && window.supabase) { sb = window.supabase.createClient(c.url, c.key); return true; } return false; }
function isMissingTable(e) { return e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /ys_items|does not exist|schema cache/i.test(e.message || '')); }
function setSyncIcon(s) { const el = $('hSync'); el.classList.remove('busy', 'ok', 'err'); if (s) el.classList.add(s); }
const Sync = {
  busy: false, again: false, timer: null, needSql: false, err: null,
  schedule() { if (!sb || !sbUser) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 1200); },
  async run() {
    if (!sb || !sbUser) return false;
    if (this.busy) { this.again = true; return false; }
    this.busy = true; setSyncIcon('busy'); let changed = false;
    try {
      changed = await this.members();
      changed = (await this.pull()) || changed;
      await this.push();
      this.needSql = false; this.err = null; sS('lastSyncAt', Date.now()); setSyncIcon('ok');
    } catch (e) {
      this.err = e; this.needSql = isMissingTable(e); setSyncIcon('err'); console.warn('sync', e);
    } finally { this.busy = false; }
    if (changed) rerenderAll(); else refreshMore();
    if ($('syncOv').classList.contains('show')) renderSync();
    if (this.again) { this.again = false; return this.run(); }
    return changed;
  },
  async members() {
    const { data, error } = await sb.from('ledger_members').select('code,name'); if (error) throw error;
    const server = new Set(data.map(r => r.code)), names = gS('lgNames', {});
    data.forEach(r => { if (r.name && !names[r.code]) names[r.code] = r.name; }); sS('lgNames', names); DB.touch(false);
    const seen = new Set(gS('srvCodes', [])), own = 'p_' + sbUser.id; let changed = false;
    for (const code of Ledgers.codes().slice()) {
      if (server.has(code) || code === 'local') continue;
      if (seen.has(code) && code !== own) { dropLocal(code); changed = true; continue; }
      if (code.startsWith('p_') && code !== own) continue;
      const { error: e2 } = await sb.from('ledger_members').upsert([{ code, user_id: sbUser.id, name: Ledgers.meta(code).name }], { onConflict: 'code,user_id', ignoreDuplicates: true });
      if (e2) throw e2; server.add(code);
    }
    for (const code of server) if (!Ledgers.codes().includes(code)) { Ledgers.add(code); await this.pull(code); changed = true; }
    sS('srvCodes', [...server]); return changed;
  },
  async pull(code) {
    const since = code ? null : gS('pullTs', null); let from = 0, max = since, changed = false;
    for (; ;) {
      let q = sb.from('ys_items').select('id,ledger,kind,data,updated_at,deleted,server_ts').order('server_ts', { ascending: true }).order('id').range(from, from + 999);
      if (code) q = q.eq('ledger', code); else if (since) q = q.gt('server_ts', new Date(new Date(since).getTime() - 10000).toISOString());
      const { data, error } = await q; if (error) throw error;
      for (const r of data) { if (merge(r)) changed = true; if (!max || new Date(r.server_ts) > new Date(max)) max = r.server_ts; }
      if (data.length < 1000) break; from += 1000;
    }
    if (!code && max) sS('pullTs', max);
    if (changed) DB.touch(); return changed;
  },
  async push() {
    const rows = Object.values(DB.map).filter(it => it.dirty && it.ledger !== 'local');
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400).map(it => ({ id: it.id, ledger: it.ledger, kind: it.kind, data: it.data, updated_at: it.updated_at, deleted: it.deleted }));
      const { error } = await sb.from('ys_items').upsert(chunk, { onConflict: 'id' }); if (error) throw error;
      chunk.forEach(r => { const it = DB.map[r.id]; if (it && it.updated_at === r.updated_at) it.dirty = false; });
    }
    if (rows.length) DB.save();
  },
};
function merge(r) {
  const l = DB.map[r.id], ru = Number(r.updated_at);
  if (l && l.updated_at > ru) return false;
  if (l && l.updated_at === ru && l.deleted === !!r.deleted) { if (l.dirty) l.dirty = false; return false; }
  DB.map[r.id] = { id: r.id, kind: r.kind, ledger: r.ledger, data: r.data, updated_at: ru, deleted: !!r.deleted, dirty: false };
  return true;
}
function renameLedger(from, to) {
  for (const k of Object.keys(DB.map)) {
    const it = DB.map[k]; if (it.ledger !== from) continue;
    const nk = DB.k(it.kind, to, it.data.id); delete DB.map[k];
    const ex = DB.map[nk]; if (ex && ex.updated_at >= it.updated_at) continue;
    DB.map[nk] = { ...it, id: nk, ledger: to, dirty: true };
  }
  sS('ledgers3', [...new Set(Ledgers.codes().map(c => c === from ? to : c))]);
  if (activeLedger === from) { activeLedger = to; sS('active3', to); }
  DB.touch();
}
async function legacyImport(code) {
  const flag = 'legacy_' + (code || sbUser.id); if (gS(flag, false)) return;
  try {
    const own = 'p_' + sbUser.id; let from = 0, n = 0;
    for (; ;) {
      let q = sb.from('transactions').select('*').order('id').range(from, from + 999); if (code) q = q.eq('ledger', code);
      const { data, error } = await q; if (error) break;
      for (const r of data || []) {
        const lg = r.ledger || own; if (!Ledgers.codes().includes(lg)) continue;
        const k = DB.k('tx', lg, String(r.id)); if (DB.map[k]) continue;
        DB.map[k] = { id: k, kind: 'tx', ledger: lg, data: v2tx(r), updated_at: 0, deleted: false, dirty: true }; n++;
      }
      if (!data || data.length < 1000) break; from += 1000;
    }
    if (n) { DB.touch(); toast('예전 클라우드 내역 ' + n + '건을 옮겨왔어요'); }
  } catch (e) { console.warn(e); }
  sS(flag, true);
}
async function afterLogin() {
  const own = 'p_' + sbUser.id;
  if (Ledgers.def() === 'local') { renameLedger('local', own); sS('defCode', own); }
  else if (!Ledgers.codes().includes(own) && Ledgers.def() !== own) { Ledgers.add(own); }
  await legacyImport();
  await Sync.run();
  rerenderAll();
}
function openSync() { renderSync(); show('syncOv'); }
function renderSync() {
  const body = $('syncBody'), cfg = sbCfg();
  if (!cfg) { body.innerHTML = cfgForm(); bindCfg(); return; }
  if (!sbUser) { body.innerHTML = loginForm(); bindLogin(); return; }
  const last = gS('lastSyncAt', null);
  let h = '';
  if (Sync.needSql) h += '<div class="status warn"><b>한 번만 설정이 더 필요해요.</b><br>새 버전은 분류·자산·결제 수단까지 모두 동기화하려고 표를 새로 써요. Supabase → SQL Editor 에 아래 SQL을 붙여넣고 Run 해 주세요.</div><div class="sql"><button id="cpSql">복사</button><pre>' + esc(SQL_TEXT) + '</pre></div>';
  else if (Sync.err) h += '<div class="status warn"><b>동기화 오류</b><br>' + esc(Sync.err.message || Sync.err) + '</div>';
  h += '<div class="status">✅ <b>' + esc(sbUser.email) + '</b> 로그인됨<br>내역·분류·자산·결제 수단·가계부 설정이 모든 기기에 자동으로 맞춰져요.' + (last ? '<br>마지막 동기화: ' + new Date(last).toLocaleString('ko-KR') : '') + '</div>';
  h += '<button class="pbtn pri" id="bSync">지금 동기화</button><button class="pbtn sec" id="bOut">로그아웃</button><button class="pbtn dng" id="bDis">연결 설정 지우기</button>';
  h += widgetSection();
  body.innerHTML = h;
  bindWidgetSection();
  if ($('cpSql')) $('cpSql').onclick = copySql;
  $('bSync').onclick = async () => { await Sync.run(); toast(Sync.err ? '동기화 실패' : '동기화 완료'); };
  $('bOut').onclick = async () => { await sb.auth.signOut(); sbUser = null; setSyncIcon(null); renderSync(); refreshMore(); };
  $('bDis').onclick = () => { if (confirm('Supabase 연결 설정을 지울까요?\n(이 기기에 저장된 가계부 내용은 그대로 남아요)')) { localStorage.removeItem('yunseul_sb'); sb.auth.signOut().catch(() => { }); sb = null; sbUser = null; setSyncIcon(null); renderSync(); refreshMore(); } };
}
/* ---------- 위젯 · 단축어 연결 ---------- */
let wCode = null, wScript = null;
const SHORTCUT_URL = 'widget/' + encodeURIComponent('가계부 기록') + '.shortcut';
function widgetSection() {
  return '<div class="guide" style="margin-top:18px"><b>📱 위젯 · 단축어 연결</b><br>아이폰 위젯(Scriptable 앱)과 "가계부 기록" 단축어가 쓰는 연결 코드예요. 이 코드로는 <b>읽기와 내역 추가만</b> 할 수 있어요. 코드를 새로 만들면 예전 코드는 바로 막혀요.<ol>' +
    '<li>처음 한 번: 아래 「설정 SQL 복사」 → Supabase 사이트 → SQL Editor 에 붙여넣고 Run</li><li>아래에서 연결 코드를 만들고 복사해 두기</li><li>위젯: App Store에서 Scriptable 설치 → "위젯 코드 복사" → Scriptable 에서 ＋ 새 스크립트에 붙여넣고 ▶ 실행 → 연결 코드 붙여넣기 → 홈 화면에 Scriptable 위젯 추가 후 이 스크립트 선택</li>' +
    '<li>단축어: "단축어 받기" → 추가할 때 연결 코드 붙여넣기 → 홈 화면에 단축어 위젯 추가</li></ol></div>' +
    (Sync.needSql ? '' : '<button class="pbtn sec" id="cpSql">설정 SQL 복사</button>') +
    (wCode ? '<textarea id="wCodeBox" readonly class="codearea">' + esc(wCode) + '</textarea><button class="pbtn pri" id="bWCopy">연결 코드 복사</button>' : '<button class="pbtn pri" id="bWKey">연결 코드 만들기</button>') +
    '<button class="pbtn sec" id="bWScript">위젯 코드 복사 (Scriptable)</button>' +
    '<a class="pbtn sec" href="' + SHORTCUT_URL + '" download="가계부 기록.shortcut">"가계부 기록" 단축어 받기</a>' +
    '<button class="pbtn dng" id="bWRevoke">연결 코드 끊기</button>';
}
function bindWidgetSection() {
  if (!wScript) fetch('widget/scriptable.js', { cache: 'no-cache' }).then(r => r.ok ? r.text() : null).then(t => { wScript = t; }).catch(() => { });
  const copy = (text, msg) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => toast('복사가 안 되면 길게 눌러 직접 복사해 주세요'));
    else toast('길게 눌러 직접 복사해 주세요');
  };
  if ($('bWKey')) $('bWKey').onclick = async () => {
    if (wCode && !confirm('연결 코드를 새로 만들면 지금 쓰는 위젯·단축어는 새 코드를 넣기 전까지 멈춰요. 계속할까요?')) return;
    const { data, error } = await sb.rpc('ys_key_create');
    if (error) { Sync.needSql = isMissingTable(error) || /ys_key_create|function/i.test(error.message || ''); alert(Sync.needSql ? '먼저 위쪽 SQL을 Supabase에서 한 번 더 실행해 주세요. (위젯용 통로가 새로 추가됐어요)' : '오류: ' + error.message); renderSync(); return; }
    const cfg = sbCfg(); wCode = 'YSW1|' + cfg.url + '|' + cfg.key + '|' + data; renderSync(); toast('연결 코드를 만들었어요. 복사 버튼을 눌러 주세요');
  };
  if ($('bWCopy')) $('bWCopy').onclick = () => { const b = $('wCodeBox'); b.select(); copy(wCode, '연결 코드를 복사했어요'); };
  $('bWScript').onclick = () => { if (!wScript) { toast('위젯 코드를 불러오는 중이에요. 잠시 후 다시 눌러 주세요'); bindWidgetSection(); return; } copy(wScript, '위젯 코드를 복사했어요. Scriptable 에 붙여넣으세요'); };
  $('bWRevoke').onclick = async () => {
    if (!confirm('연결 코드를 끊을까요? 위젯과 단축어가 더 이상 가계부를 읽거나 기록하지 못해요.')) return;
    const { error } = await sb.rpc('ys_key_revoke'); if (error) { alert('오류: ' + error.message); return; }
    wCode = null; renderSync(); toast('연결을 끊었어요');
  };
}
function copySql() { const b = $('cpSql'), t0 = b.textContent; (navigator.clipboard ? navigator.clipboard.writeText(SQL_TEXT) : Promise.reject()).then(() => { b.textContent = '복사됨'; toast('SQL을 복사했어요. Supabase SQL Editor 에 붙여넣고 Run 하세요'); setTimeout(() => b.textContent = t0, 1500); }).catch(() => toast('길게 눌러 직접 복사해 주세요')); }
function cfgForm() { return '<div class="guide"><b>처음 한 번만 (약 5분 · 무료)</b><ol><li><a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> 가입 → New project</li><li>SQL Editor 에 아래 SQL 붙여넣고 Run</li><li>Authentication → Sign In / Providers → Email 의 Confirm email 끄기</li><li>Project Settings → API 에서 Project URL 과 anon public key 복사</li></ol></div><div class="sql"><button id="cpSql">복사</button><pre>' + esc(SQL_TEXT) + '</pre></div><div class="ifield"><label>Project URL</label><input id="cU" placeholder="https://xxxx.supabase.co" autocomplete="off"/></div><div class="ifield"><label>anon public key</label><input id="cK" placeholder="eyJhbGci..." autocomplete="off"/></div><button class="pbtn pri" id="bCon">연결하기</button>'; }
function bindCfg() {
  $('cpSql').onclick = copySql;
  $('bCon').onclick = () => {
    const url = $('cU').value.trim().replace(/\/+$/, ''), key = $('cK').value.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) { toast('Project URL 을 확인해 주세요'); return; }
    if (key.length < 20) { toast('anon key 를 확인해 주세요'); return; }
    localStorage.setItem('yunseul_sb', JSON.stringify({ url, key })); if (initSb()) renderSync();
  };
}
function loginForm() { return '<div class="guide">이메일·비밀번호로 로그인하면 이 계정을 쓰는 모든 기기(아이폰·맥)가 자동으로 동기화돼요. 처음이라면 "회원가입"을 눌러 주세요.</div><div class="ifield"><label>이메일</label><input id="aE" type="email" autocomplete="username" placeholder="me@example.com"/></div><div class="ifield"><label>비밀번호 (6자 이상)</label><input id="aP" type="password" autocomplete="current-password" placeholder="••••••"/></div><button class="pbtn pri" id="bLogin">로그인</button><button class="pbtn sec" id="bSignup">회원가입</button><button class="pbtn dng" id="bReset">연결 설정 바꾸기</button>'; }
function bindLogin() { $('bLogin').onclick = () => auth('login'); $('bSignup').onclick = () => auth('signup'); $('bReset').onclick = () => { localStorage.removeItem('yunseul_sb'); sb = null; renderSync(); }; }
async function auth(mode) {
  const email = $('aE').value.trim(), pw = $('aP').value;
  if (!email || pw.length < 6) { toast('이메일과 6자 이상 비밀번호를 입력해 주세요'); return; }
  try {
    const r = mode === 'signup' ? await sb.auth.signUp({ email, password: pw }) : await sb.auth.signInWithPassword({ email, password: pw });
    if (r.error) { toast('오류: ' + r.error.message); return; }
    if (!r.data.session) { alert('확인 이메일을 보냈어요. 메일의 링크를 누른 뒤 다시 로그인하거나, Supabase 에서 Confirm email 을 꺼 주세요.'); return; }
    sbUser = r.data.user; renderSync(); await afterLogin(); renderSync(); toast(Sync.err ? '로그인됨 · 동기화 설정 확인 필요' : '동기화됐어요');
  } catch (e) { toast('오류: ' + (e.message || e)); }
}

/* ===================== 공통 UI ===================== */
let tT = null; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('show'), 2400); }
let zTop = 40;
function show(id) { const el = $(id); el.style.zIndex = ++zTop; el.classList.add('show'); }
function hide(id) { $(id).classList.remove('show'); }
let gpResolve = null;
function pick(title, items, sel, msg) {
  if (gpResolve) gpResolve(null);
  return new Promise(res => {
    gpResolve = res; $('gpTitle').textContent = title; $('gpMsg').textContent = msg || ''; $('gpMsg').style.display = msg ? 'block' : 'none';
    const radio = sel !== undefined;
    $('gpList').innerHTML = items.map(it => '<div class="ci gp' + (radio && it.id === sel ? ' sel' : '') + (it.danger ? ' danger' : '') + '" data-id="' + esc(it.id) + '">' + (radio ? '<div class="radio"></div>' : '') + (it.em ? '<span class="em">' + esc(it.em) + '</span>' : '') + '<span class="nm">' + esc(it.label) + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</span></div>').join('');
    $('gpList').querySelectorAll('.ci').forEach(el => el.onclick = () => gpDone(el.dataset.id));
    show('gpOv');
  });
}
function gpDone(v) { hide('gpOv'); const r = gpResolve; gpResolve = null; if (r) r(v); }
function rerenderAll() {
  if (!Ledgers.codes().includes(activeLedger)) { activeLedger = Ledgers.codes()[0]; sS('active3', activeLedger); }
  render(); refreshMore(); refreshOpenSheets(); refreshDay();
  if ($('ledgerOv').classList.contains('show')) renderLedger();
}
function switchTab(t) {
  const map = { cal: ['calPane', 'tabLedger'], asset: ['assetPane', 'tabAsset'], trend: ['trendPane', 'tabTrend'], more: ['morePane', 'tabMore'] };
  for (const [k, [p, b]] of Object.entries(map)) { $(p).classList.toggle('on', k === t); $(b).className = k === t ? 'active' : ''; }
  if (t === 'more') refreshMore(); if (t === 'asset') renderAssets(); if (t === 'trend') renderTrends(); if (t === 'cal') render();
}

/* ===================== 이벤트 연결 ===================== */
['dayOv', 'formOv', 'repOv', 'pickOv', 'edOv', 'asEdOv', 'acDetOv', 'trOv', 'payOv', 'payEdOv', 'statOv', 'drillOv', 'mpOv', 'srchOv', 'syncOv', 'ledgerOv', 'lgEdOv', 'startOv', 'gpOv'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id !== id) return; if (id === 'gpOv') gpDone(null); else hide(id); }));
bindAmtInput($('fAmt'), amtShow); bindAmtInput($('asBal')); bindAmtInput($('trAmt')); bindAmtInput($('trFee'));
const calEl = $('cal'); let tx0 = null, ty0 = null, mx0 = null;
calEl.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; }, { passive: true });
calEl.addEventListener('touchend', e => { if (tx0 == null) return; const dx = e.changedTouches[0].clientX - tx0, dy = e.changedTouches[0].clientY - ty0; if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) shift(dx < 0 ? 1 : -1); tx0 = null; });
calEl.addEventListener('mousedown', e => mx0 = e.clientX);
window.addEventListener('mouseup', e => { if (mx0 == null) return; const dx = e.clientX - mx0; if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1); mx0 = null; });
window.addEventListener('keydown', e => { if (document.querySelector('.ov.show') || !$('calPane').classList.contains('on') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; if (e.key === 'ArrowLeft') shift(-1); if (e.key === 'ArrowRight') shift(1); });

$('monthTitle').onclick = openMonthPicker;
$('mpPrev').onclick = () => { mpY--; renderMP(); }; $('mpNext').onclick = () => { mpY++; renderMP(); };
$('mpToday').onclick = () => { anchorToToday(); hide('mpOv'); render(); };
function addToday(t) { selDate = inPeriod(todayKey()) ? todayKey() : ymd(period(anchorY, anchorM).start); openForm(t); }
$('addIncome').onclick = () => addToday('income'); $('addExpense').onclick = () => addToday('expense');
$('daddIn').onclick = () => openForm('income'); $('daddEx').onclick = () => openForm('expense');
$('segIn').onclick = () => setFormType('income'); $('segEx').onclick = () => setFormType('expense');
$('fCatChip').onclick = () => openPicker(form.type, true);
$('fDate').addEventListener('click', e => { try { e.target.showPicker && e.target.showPicker(); } catch (er) { } });
$('fDate').onchange = () => { if (!$('fDate').value) $('fDate').value = selDate; syncForm(); };
$('fPayChip').onclick = pickPayOrAcct; $('fRepChip').onclick = openRep;
$('fSave').onclick = saveForm; $('fDel').onclick = delForm; $('fCancel').onclick = () => hide('formOv');
$('fMemo').addEventListener('keydown', e => { if (e.key === 'Enter') saveForm(); });
$('repEndOn').onchange = renderRep; $('repDone').onclick = doneRep;

$('pkAdd').onclick = () => openEditor(null);
$('pkDone').onclick = () => { hide('pickOv'); if (pickFromForm) syncForm(); else { refreshMore(); render(); } };
$('edClose').onclick = () => hide('edOv'); $('edEmoji').addEventListener('input', edPrev); $('edSave').onclick = saveEditor; $('edDel').onclick = delEditor;

$('hStats').onclick = openStats; $('hSync').onclick = openSync; $('hSearch').onclick = openSearch; $('hLedger').onclick = openLedger; $('lgName').onclick = openLedger;
$('sumAsset').onclick = () => switchTab('asset');
$('ledgerClose').onclick = () => hide('ledgerOv');
$('srchInput').addEventListener('input', runSearch); ['srchFrom', 'srchTo', 'srchSort'].forEach(id => $(id).addEventListener('change', runSearch));
$('srchClose').onclick = () => hide('srchOv');
$('stClose').onclick = $('stX').onclick = () => hide('statOv');
$('stIn').onclick = () => { statType = 'income'; statPay = false; renderStats(); }; $('stEx').onclick = () => { statType = 'expense'; renderStats(); };
$('stSub').onclick = () => { statSub = !statSub; statPay = false; renderStats(); }; $('stPay').onclick = () => { statPay = !statPay; renderStats(); };
$('stSort').onclick = () => { statAsc = !statAsc; renderStats(); };
$('drSort').onclick = () => { drByAmt = !drByAmt; renderDrill(); }; $('drClose').onclick = $('drX').onclick = () => hide('drillOv');

$('tabLedger').onclick = () => switchTab('cal'); $('tabAsset').onclick = () => switchTab('asset'); $('tabTrend').onclick = () => switchTab('trend'); $('tabMore').onclick = () => switchTab('more');
$('asAdd').onclick = () => openAssetEditor(null); $('asTransfer').onclick = () => openTransfer(null);
$('asEdClose').onclick = () => hide('asEdOv');
$('asKinds').querySelectorAll('button').forEach(b => b.onclick = () => { asEd.kind = b.dataset.k; asKind(); });
$('asEmoji').addEventListener('input', asEdPrev); $('asEdSave').onclick = saveAssetEditor; $('asEdDel').onclick = delAssetEditor;
$('acDetClose').onclick = () => hide('acDetOv'); $('acDetEdit').onclick = () => openAssetEditor(acDetId); $('acDetTr').onclick = () => openTransfer(acDetId);
$('trClose').onclick = () => hide('trOv'); $('trSave').onclick = saveTransfer; $('trDel').onclick = delTransfer;
$('trPrev').onclick = () => { trY--; renderTrends(); }; $('trNext').onclick = () => { trY++; renderTrends(); };
$('trCat').onchange = () => { trCat = $('trCat').value; renderTrends(); };
$('payAdd').onclick = () => openPayEd(null); $('payClose').onclick = () => { hide('payOv'); if ($('formOv').classList.contains('show')) syncForm(); };
$('payEdClose').onclick = () => hide('payEdOv'); $('payEdSave').onclick = savePayEd; $('payEdDel').onclick = delPayEd;
$('lgEdClose').onclick = () => hide('lgEdOv'); $('lgSave').onclick = saveLgEd; $('lgDel').onclick = delLgEd;
$('lgCopy').onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(lgEdCode).then(() => toast('코드를 복사했어요')).catch(() => toast(lgEdCode)); else toast(lgEdCode); };
$('gpCancel').onclick = () => gpDone(null);

$('mLedger').onclick = openLedger; $('mStartDay').onclick = openStartDay; $('mCurrency').onclick = chooseCurrency;
$('mCatIn').onclick = () => openPicker('income', false); $('mCatEx').onclick = () => openPicker('expense', false); $('mPay').onclick = openPayMgr;
$('mTheme').onclick = chooseTheme; $('mSync').onclick = openSync;
$('mExport').onclick = exportCSV; $('mBackup').onclick = exportBackup;
$('mRestore').onclick = () => $('restoreFile').click();
$('restoreFile').onchange = e => { const f = e.target.files[0]; if (f) restoreBackup(f); e.target.value = ''; };
$('mAbout').onclick = () => alert('유림 가계부 v3.0\n캘린더로 관리하는 수입·지출 가계부\n\n아이폰은 Safari → 공유 → "홈 화면에 추가"로 앱처럼 쓸 수 있어요.');

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { Sync.run(); render(); } });
setInterval(() => { if (document.visibilityState === 'visible') Sync.run(); }, 45000);

/* ===================== 시작 ===================== */
function boot() {
  DB.load(); migrateV2();
  if (!Ledgers.codes().includes(activeLedger)) { activeLedger = Ledgers.codes()[0]; sS('active3', activeLedger); }
  if (!DB.get('meta', 'meta', Ledgers.def()) && !DB.list('cat', Ledgers.def()).length) seedLedger(Ledgers.def(), { name: '기본 가계부' }, 0);
  applyTheme(); anchorToToday(); render(); refreshMore();
  if (initSb()) {
    sb.auth.getSession().then(async ({ data }) => { if (data && data.session) { sbUser = data.session.user; await afterLogin(); } }).catch(e => console.warn(e));
  }
}
boot();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
