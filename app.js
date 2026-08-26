// Duty Roster app logic — Firestore-backed version for GitHub Pages / PWA install.
// Firestore layout:
//   operators/{stationCode}          -> { names: [...] }
//   duty/{stationCode}_{yyyy-mm-dd}  -> { entries: { operatorName: { counter, shift } } }
//   pins/{stationCode}               -> { pin: "1234" }
//   pins/owner                       -> { pin: "1234" }

(function () {
  // Try to enable offline cache so the app still opens (read-only) without a connection.
  try { db.enablePersistence({ synchronizeTabs: true }); } catch (e) { console.warn('Persistence not enabled:', e); }

  const STATIONS = [
    { code: 'Mtn', name: 'Multan', color: '#2E7D6B' },
    { code: 'Oka', name: 'Okara', color: '#C6821E' },
    { code: 'Bwp', name: 'Bhawalpur', color: '#4059A5' }
  ];
  const REGULAR = ['CR Complex', 'MDC', 'Panel', 'Candidates', 'IPD Billing', 'Refund'];
  const SHIFT_COUNTERS = ['A&E', 'Lab'];
  const SHIFTS = ['Morning', 'Evening', 'Night'];
  const REST = 'REST/ L';
  const ALL_COUNTERS = [...SHIFT_COUNTERS, ...REGULAR];
  const DEFAULT_PINS = { Mtn: '7867', Bwp: '7861', Oka: '7862' };
  const COUNTER_LABELS = { 'CR Complex': 'CR' };
  function counterLabel(c) { return COUNTER_LABELS[c] || c; }

  let state = {
    screen: 'home', station: null, tab: 'duty',
    ownerUnlocked: false, stationUnlocked: false,
    date: todayISO(), reportMonth: monthISO(), reportStation: 'Mtn',
    selectedCounter: null
  };
  let pollTimer = null;
  let lastReport = null;
  let lastCounterReport = null;

  function todayISO() { const d = new Date(); return d.toISOString().slice(0, 10); }
  function monthISO() { return todayISO().slice(0, 7); }
  function stationOf(code) { return STATIONS.find(s => s.code === code); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function showToast(msg) {
    const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Firestore helpers ----------
  async function getOperators(code) {
    try {
      const doc = await db.collection('operators').doc(code).get();
      return doc.exists ? (doc.data().names || []) : [];
    } catch (e) { console.error(e); showToast('Could not load operators'); return []; }
  }
  async function saveOperators(code, list) {
    try { await db.collection('operators').doc(code).set({ names: list }); }
    catch (e) { console.error(e); showToast('Could not save — check your connection'); }
  }
  async function getDuty(code, date) {
    try {
      const doc = await db.collection('duty').doc(code + '_' + date).get();
      return doc.exists ? (doc.data().entries || {}) : {};
    } catch (e) { console.error(e); showToast('Could not load duty data'); return {}; }
  }
  async function saveDuty(code, date, obj) {
    try { await db.collection('duty').doc(code + '_' + date).set({ entries: obj }); }
    catch (e) { console.error(e); showToast('Could not save — check your connection'); }
  }
  async function getStationPin(code) {
    try {
      const doc = await db.collection('pins').doc(code).get();
      if (doc.exists) return doc.data().pin;
      await db.collection('pins').doc(code).set({ pin: DEFAULT_PINS[code] });
      return DEFAULT_PINS[code];
    } catch (e) { console.error(e); return DEFAULT_PINS[code]; }
  }
  async function setStationPin(code, val) {
    try { await db.collection('pins').doc(code).set({ pin: val }); }
    catch (e) { console.error(e); showToast('Could not save PIN'); }
  }
  async function getOwnerPin() {
    try {
      const doc = await db.collection('pins').doc('owner').get();
      if (doc.exists) return doc.data().pin;
      await db.collection('pins').doc('owner').set({ pin: '1234' });
      return '1234';
    } catch (e) { console.error(e); return '1234'; }
  }
  async function setOwnerPin(val) {
    try { await db.collection('pins').doc('owner').set({ pin: val }); }
    catch (e) { console.error(e); showToast('Could not save PIN'); }
  }
  async function computeMonthCounts(code, month) {
    const ops = await getOperators(code);
    const counts = {};
    ops.forEach(o => counts[o] = {});
    try {
      const snap = await db.collection('duty')
        .where(firebase.firestore.FieldPath.documentId(), '>=', code + '_' + month + '-01')
        .where(firebase.firestore.FieldPath.documentId(), '<=', code + '_' + month + '-31')
        .get();
      snap.forEach(doc => {
        const entries = (doc.data() || {}).entries || {};
        Object.entries(entries).forEach(([op, d]) => {
          if (!counts[op]) counts[op] = {};
          const c = d.counter;
          counts[op][c] = (counts[op][c] || 0) + 1;
          if (d.shift) {
            const sk = c + '-' + d.shift;
            counts[op][sk] = (counts[op][sk] || 0) + 1;
          }
        });
      });
    } catch (e) { console.error(e); showToast('Could not load month data'); }
    return { ops, counts };
  }

  // ---------- render root ----------
  async function render() {
    const app = document.getElementById('app');
    if (state.screen === 'home') { app.innerHTML = renderHome(); bindHome(); return; }
    if (state.screen === 'admin-gate') { app.innerHTML = await renderAdminGate(); bindAdminGate(); return; }
    if (state.screen === 'admin') {
      const html = await renderAdmin();
      if (state.screen === 'admin') { app.innerHTML = html; bindAdmin(); } else { render(); }
      return;
    }
    if (state.screen === 'owner-gate') { app.innerHTML = renderOwnerGate(); bindOwnerGate(); return; }
    if (state.screen === 'owner') { app.innerHTML = await renderOwner(); bindOwner(); return; }
  }

  function topbar(title, sub, showBack) {
    return `<div class="topbar">
      <div class="brand" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="brand-mark">DR</div>
          <div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
        </div>
        ${showBack ? '<button class="back-btn" id="btnBack">← Home</button>' : ''}
      </div>
    </div>`;
  }

  // ---------- HOME ----------
  function renderHome() {
    let cards = STATIONS.map(s => `
      <button class="role-card" data-station="${s.code}">
        <div class="station-badge" style="background:${s.color}">${s.code.toUpperCase()}</div>
        <div class="rt"><div class="name">${esc(s.name)} Admin</div><div class="desc">Manage operators & enter daily duty</div></div>
        <div class="chev">›</div>
      </button>`).join('');
    return topbar('Duty Roster', 'Multan · Okara · Bhawalpur', false) + `
      <div class="container">
        <div class="eyebrow" style="margin-bottom:6px;">Select station</div>
        <div class="role-grid">${cards}</div>
        <div class="eyebrow" style="margin:22px 0 6px;">Owner</div>
        <div class="role-grid">
          <button class="role-card" id="btnOwner">
            <div class="station-badge" style="background:var(--navy)">★</div>
            <div class="rt"><div class="name">Monthly Report & Control</div><div class="desc">View all stations, delete entries, PIN protected</div></div>
            <div class="chev">›</div>
          </button>
        </div>
      </div>`;
  }
  function bindHome() {
    document.querySelectorAll('[data-station]').forEach(el => {
      el.addEventListener('click', () => { state.screen = 'admin-gate'; state.station = el.dataset.station; state.stationUnlocked = false; state.tab = 'duty'; render(); });
    });
    document.getElementById('btnOwner').addEventListener('click', () => { state.screen = 'owner-gate'; render(); stopPoll(); });
  }

  // ---------- ADMIN PIN GATE ----------
  async function renderAdminGate() {
    const st = stationOf(state.station);
    return topbar(st.name + ' Admin', 'Enter your station PIN', true) + `
      <div class="container">
        <div class="pin-box">
          <div style="font-size:13px;color:var(--muted);margin-bottom:14px;">This PIN is known only to you and the Owner. Contact the Owner if you've forgotten it.</div>
          <input class="field pin-input" id="pinInput" type="password" inputmode="numeric" maxlength="8" placeholder="••••"/>
          <button class="btn btn-primary" id="btnUnlock" style="width:100%;margin-top:12px;">Unlock</button>
        </div>
      </div>`;
  }
  function bindAdminGate() {
    document.getElementById('btnBack').addEventListener('click', () => { state.screen = 'home'; render(); });
    async function tryUnlock() {
      const entered = document.getElementById('pinInput').value.trim();
      const correct = await getStationPin(state.station);
      if (entered === correct) { state.stationUnlocked = true; state.screen = 'admin'; render(); startPoll(); }
      else showToast('Incorrect PIN');
    }
    document.getElementById('btnUnlock').addEventListener('click', tryUnlock);
    document.getElementById('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
  }

  // ---------- ADMIN ----------
  async function renderAdmin() {
    if (!state.stationUnlocked) { state.screen = 'admin-gate'; return renderAdminGate(); }
    const code = state.station, st = stationOf(code);
    const tabsHtml = `<div class="tabs">
        <button class="tab ${state.tab === 'duty' ? 'active' : ''}" data-tab="duty">Today's Duty</button>
        <button class="tab ${state.tab === 'operators' ? 'active' : ''}" data-tab="operators">Operators</button>
        <button class="tab ${state.tab === 'history' ? 'active' : ''}" data-tab="history">History</button>
        <button class="tab ${state.tab === 'settings' ? 'active' : ''}" data-tab="settings">PIN</button>
      </div>`;
    let body = '';
    if (state.tab === 'operators') body = await renderOperatorsTab(code);
    else if (state.tab === 'duty') body = await renderDutyTab(code);
    else if (state.tab === 'settings') body = await renderAdminSettingsTab(code);
    else body = await renderHistoryTab(code);
    return topbar(st.name + ' Admin', st.code.toUpperCase() + ' station', true) +
      `<div class="container">${tabsHtml}${body}</div>`;
  }

  async function renderOperatorsTab(code) {
    const ops = await getOperators(code);
    const rows = ops.length ? ops.map(n => `
      <div class="op-row"><div class="op-name">${esc(n)}</div>
        <button class="op-remove" data-remove="${esc(n)}">✕</button></div>`).join('')
      : `<div class="empty">No operators added yet. Add names below — they'll stay listed for every future day.</div>`;
    return `<div class="card">
        <h3>Add operator</h3>
        <div class="row-flex">
          <input class="field" id="newOpName" placeholder="Operator name" maxlength="60"/>
          <button class="btn btn-accent" id="btnAddOp">Add</button>
        </div>
      </div>
      <div class="card"><h3>Roster (${ops.length})</h3>${rows}</div>`;
  }

  async function renderDutyTab(code) {
    const ops = await getOperators(code);
    const duty = await getDuty(code, state.date);
    if (!ops.length) {
      return `<div class="card"><div class="empty">Add operators first in the Operators tab before entering duty.</div></div>`;
    }
    const rows = ops.map(n => {
      const existing = duty[n];
      if (existing) {
        const shiftDot = existing.shift ? `<span class="shift-dot dot-${existing.shift}"></span>${existing.shift} · ` : '';
        return `<div class="duty-row">
          <div class="name">${esc(n)}<span class="locked-badge">✓ Saved</span></div>
          <div class="counter-pill">${shiftDot}${esc(counterLabel(existing.counter))}</div>
        </div>`;
      }
      const shiftSelId = 'shift_' + btoa(n).replace(/=/g, '');
      const counterSelId = 'counter_' + btoa(n).replace(/=/g, '');
      const counterOpts = ['', ...ALL_COUNTERS, REST].map(c => c === '' ?
        `<option value="">Select counter…</option>` : `<option value="${esc(c)}">${esc(counterLabel(c))}</option>`).join('');
      return `<div class="duty-row" data-op="${esc(n)}">
          <div class="name">${esc(n)}</div>
          <div class="duty-controls">
            <select class="field counter-select" id="${counterSelId}" data-op="${esc(n)}">${counterOpts}</select>
            <select class="field shift-select" id="${shiftSelId}" data-op="${esc(n)}" style="display:none;">
              <option value="">Select shift…</option>
              ${SHIFTS.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-sm save-duty-btn" data-op="${esc(n)}" style="margin-top:9px;width:100%;">Save duty</button>
        </div>`;
    }).join('');
    return `<div class="date-picker-row">
        <button class="btn btn-ghost btn-sm" id="dateBack">‹</button>
        <input type="date" class="field" id="dutyDate" value="${state.date}"/>
        <button class="btn btn-ghost btn-sm" id="dateFwd">›</button>
      </div>
      <div class="row-flex" style="margin:-6px 0 14px;">
        <button class="btn btn-ghost btn-sm" data-jump="0">Today</button>
        <button class="btn btn-ghost btn-sm" data-jump="7">+1 Week</button>
        <button class="btn btn-ghost btn-sm" data-jump="30">+1 Month</button>
      </div>
      <div style="font-size:11.5px;color:var(--muted);margin:-6px 0 14px;">You can plan and save duty for any future date — pick it above, no restrictions.</div>
      ${rows}`;
  }

  async function renderHistoryTab(code) {
    const duty = await getDuty(code, state.date);
    const entries = Object.entries(duty);
    const lines = entries.length ? entries.map(([n, d]) => {
      const shiftDot = d.shift ? `<span class="shift-dot dot-${d.shift}"></span>${d.shift} · ` : '';
      return `<div class="saved-line"><span>${esc(n)}</span><span class="counter-pill">${shiftDot}${esc(counterLabel(d.counter))}</span></div>`;
    }).join('') : `<div class="empty">No duty recorded for this date.</div>`;
    return `<div class="date-picker-row">
        <button class="btn btn-ghost btn-sm" id="histBack">‹</button>
        <input type="date" class="field" id="histDate" value="${state.date}"/>
        <button class="btn btn-ghost btn-sm" id="histFwd">›</button>
      </div>
      <div class="card"><h3>Duty on ${esc(state.date)}</h3>${lines}</div>`;
  }

  async function renderAdminSettingsTab(code) {
    const pin = await getStationPin(code);
    return `<div class="card">
        <h3>Your station PIN</h3>
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px;">This PIN is visible only to you and the Owner. Current PIN:</div>
        <div class="pin-input" style="text-align:left;font-size:20px;margin-bottom:14px;">${esc(pin)}</div>
        <div class="row-flex">
          <input class="field" id="newStationPin" type="password" inputmode="numeric" maxlength="8" placeholder="New PIN"/>
          <button class="btn btn-primary" id="btnSaveStationPin">Save</button>
        </div>
      </div>`;
  }

  function bindAdmin() {
    document.getElementById('btnBack').addEventListener('click', () => { stopPoll(); state.screen = 'home'; render(); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); }));

    if (state.tab === 'operators') {
      document.getElementById('btnAddOp').addEventListener('click', addOperatorHandler);
      document.getElementById('newOpName').addEventListener('keydown', e => { if (e.key === 'Enter') addOperatorHandler(); });
      document.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
        const code = state.station; const name = b.dataset.remove;
        if (!confirm('Remove ' + name + ' from the roster? Past duty records are kept, only future entry is removed.')) return;
        const ops = await getOperators(code);
        await saveOperators(code, ops.filter(n => n !== name));
        render();
      }));
    }
    if (state.tab === 'duty') {
      document.getElementById('dutyDate').addEventListener('change', e => { state.date = e.target.value; render(); });
      document.getElementById('dateBack').addEventListener('click', () => { shiftDate(-1); render(); });
      document.getElementById('dateFwd').addEventListener('click', () => { shiftDate(1); render(); });
      document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
        const days = parseInt(b.dataset.jump, 10);
        const d = days === 0 ? new Date() : new Date(state.date + 'T00:00:00');
        if (days > 0) d.setDate(d.getDate() + days);
        state.date = d.toISOString().slice(0, 10);
        render();
      }));
      document.querySelectorAll('.counter-select').forEach(sel => {
        sel.addEventListener('change', () => {
          const op = sel.dataset.op;
          const shiftSel = document.querySelector('.shift-select[data-op="' + CSS.escape(op) + '"]');
          if (SHIFT_COUNTERS.includes(sel.value)) { shiftSel.style.display = 'block'; }
          else { shiftSel.style.display = 'none'; shiftSel.value = ''; }
        });
      });
      document.querySelectorAll('.save-duty-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const op = btn.dataset.op;
          const counterSel = document.querySelector('.counter-select[data-op="' + CSS.escape(op) + '"]');
          const shiftSel = document.querySelector('.shift-select[data-op="' + CSS.escape(op) + '"]');
          const counter = counterSel.value;
          if (!counter) { showToast('Select a counter for ' + op); return; }
          let shift = null;
          if (SHIFT_COUNTERS.includes(counter)) {
            shift = shiftSel.value;
            if (!shift) { showToast('Select a shift for ' + op); return; }
          }
          const code = state.station;
          const duty = await getDuty(code, state.date);
          duty[op] = { counter, shift };
          await saveDuty(code, state.date, duty);
          showToast('Saved ' + op + ' — ' + counter + (shift ? ' (' + shift + ')' : ''));
          render();
        });
      });
    }
    if (state.tab === 'history') {
      document.getElementById('histDate').addEventListener('change', e => { state.date = e.target.value; render(); });
      document.getElementById('histBack').addEventListener('click', () => { shiftDate(-1); render(); });
      document.getElementById('histFwd').addEventListener('click', () => { shiftDate(1); render(); });
    }
    if (state.tab === 'settings') {
      document.getElementById('btnSaveStationPin').addEventListener('click', async () => {
        const val = document.getElementById('newStationPin').value.trim();
        if (val.length < 4) { showToast('PIN must be at least 4 digits'); return; }
        await setStationPin(state.station, val);
        showToast('PIN updated');
        render();
      });
    }
  }

  function shiftDate(delta) {
    const d = new Date(state.date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    state.date = d.toISOString().slice(0, 10);
  }

  async function addOperatorHandler() {
    const input = document.getElementById('newOpName');
    const name = input.value.trim();
    if (!name) return;
    const code = state.station;
    const ops = await getOperators(code);
    if (ops.some(n => n.toLowerCase() === name.toLowerCase())) { showToast(name + ' is already on the roster'); return; }
    ops.push(name);
    await saveOperators(code, ops);
    input.value = '';
    render();
  }

  // ---------- OWNER GATE ----------
  function renderOwnerGate() {
    return topbar('Owner Access', 'Enter PIN to continue', true) + `
      <div class="container">
        <div class="pin-box">
          <div style="font-size:13px;color:var(--muted);margin-bottom:14px;">Default PIN is <b>1234</b> — you can change it once inside.</div>
          <input class="field pin-input" id="pinInput" type="password" inputmode="numeric" maxlength="8" placeholder="••••"/>
          <button class="btn btn-primary" id="btnUnlock" style="width:100%;margin-top:12px;">Unlock</button>
        </div>
      </div>`;
  }
  function bindOwnerGate() {
    document.getElementById('btnBack').addEventListener('click', () => { state.screen = 'home'; render(); });
    async function tryUnlock() {
      const entered = document.getElementById('pinInput').value.trim();
      const storedPin = await getOwnerPin();
      if (entered === storedPin) { state.ownerUnlocked = true; state.screen = 'owner'; render(); startPoll(); }
      else showToast('Incorrect PIN');
    }
    document.getElementById('btnUnlock').addEventListener('click', tryUnlock);
    document.getElementById('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
  }

  // ---------- OWNER ----------
  async function renderOwner() {
    const tabsHtml = `<div class="tabs">
        <button class="tab ${state.tab === 'report' ? 'active' : ''}" data-tab="report">Monthly Report</button>
        <button class="tab ${state.tab === 'counter' ? 'active' : ''}" data-tab="counter">By Counter</button>
        <button class="tab ${state.tab === 'log' ? 'active' : ''}" data-tab="log">Live Log & Delete</button>
        <button class="tab ${state.tab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
      </div>`;
    let body = '';
    if (!state.tab || !['report', 'counter', 'log', 'settings'].includes(state.tab)) state.tab = 'report';
    if (state.tab === 'report') body = await renderReportTab();
    else if (state.tab === 'counter') body = await renderCounterReportTab();
    else if (state.tab === 'log') body = await renderLogTab();
    else body = await renderSettingsTab();
    return topbar('Owner Console', 'All stations · real-time', true) + `<div class="container">${tabsHtml}${body}</div>`;
  }

  async function renderReportTab() {
    const stationBtns = STATIONS.map(s => `<option value="${s.code}" ${state.reportStation === s.code ? 'selected' : ''}>${s.name}</option>`).join('');
    const code = state.reportStation;
    const { ops, counts } = await computeMonthCounts(code, state.reportMonth);
    const allOpNames = Array.from(new Set([...ops, ...Object.keys(counts)]));
    const cols = [...ALL_COUNTERS, REST];
    const header = `<tr><th class="opname" style="position:sticky;left:0;">Operator</th>` +
      cols.map(c => `<th>${esc(counterLabel(c))}</th>`).join('') + `<th>Total days</th></tr>`;
    const rowsData = [];
    const rows = allOpNames.length ? allOpNames.map(op => {
      const c = counts[op] || {};
      let total = 0;
      const rawRow = [op];
      const cells = cols.map(col => {
        const v = c[col] || 0; total += v;
        rawRow.push(v);
        let sub = '';
        if (SHIFT_COUNTERS.includes(col)) {
          const parts = SHIFTS.map(s => c[col + '-' + s] ? s.slice(0, 1) + ':' + c[col + '-' + s] : null).filter(Boolean);
          if (parts.length) sub = `<div style="font-size:9px;color:var(--muted);margin-top:2px;">${parts.join(' ')}</div>`;
        }
        return `<td>${v || '—'}${sub}</td>`;
      }).join('');
      rawRow.push(total);
      rowsData.push(rawRow);
      return `<tr><td class="opname">${esc(op)}</td>${cells}<td class="total-cell">${total}</td></tr>`;
    }).join('') : `<tr><td colspan="${cols.length + 2}" class="empty">No operators or duty data for this station.</td></tr>`;

    lastReport = { stationName: stationOf(code).name, month: state.reportMonth, cols, rowsData };

    return `<div class="card">
        <div class="month-summary-header">
          <select class="field" id="repStation" style="max-width:180px;">${stationBtns}</select>
          <input type="month" class="field" id="repMonth" value="${state.reportMonth}" style="max-width:170px;"/>
        </div>
        <div class="report-actions">
          <button class="btn btn-ghost btn-sm" id="btnPrintReport">🖨️ Print</button>
          <button class="btn btn-ghost btn-sm" id="btnDownloadReport">⬇ Download CSV</button>
        </div>
        <div class="table-scroll"><table class="summary">${header}${rows}</table></div>
        <div style="font-size:11px;color:var(--muted);margin-top:10px;">Shift breakdown shown under A&E / Lab totals — M = Morning, E = Evening, N = Night.</div>
      </div>`;
  }

  async function renderCounterReportTab() {
    const stationBtns = STATIONS.map(s => `<option value="${s.code}" ${state.reportStation === s.code ? 'selected' : ''}>${s.name}</option>`).join('');
    const code = state.reportStation;
    if (!state.selectedCounter) state.selectedCounter = 'A&E';
    const counterList = [...ALL_COUNTERS, REST];
    const chips = counterList.map(c =>
      `<button class="btn btn-sm ${c === state.selectedCounter ? 'btn-primary' : 'btn-ghost'}" data-counter="${esc(c)}" style="margin:0 6px 6px 0;">${esc(counterLabel(c))}</button>`
    ).join('');

    const { ops, counts } = await computeMonthCounts(code, state.reportMonth);
    const selCounter = state.selectedCounter;
    const allOpNames = Array.from(new Set([...ops, ...Object.keys(counts)]));
    let rowsArr = allOpNames.map(op => {
      const c = counts[op] || {};
      const days = c[selCounter] || 0;
      let subParts = [];
      if (SHIFT_COUNTERS.includes(selCounter)) {
        subParts = SHIFTS.map(s => c[selCounter + '-' + s] ? s + ': ' + c[selCounter + '-' + s] : null).filter(Boolean);
      }
      return { op, days, subParts };
    }).filter(r => r.days > 0);
    rowsArr.sort((a, b) => b.days - a.days);

    lastCounterReport = { stationName: stationOf(code).name, month: state.reportMonth, counter: counterLabel(selCounter), rows: rowsArr };

    const tableRows = rowsArr.length ? rowsArr.map((r, i) => `
        <tr>
          <td style="text-align:center;color:var(--muted);font-weight:700;">${i + 1}</td>
          <td class="opname">${esc(r.op)}</td>
          <td class="total-cell">${r.days}</td>
          <td style="font-size:11px;color:var(--muted);text-align:left;">${r.subParts.join(' · ')}</td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="empty">No one performed duty on ${esc(counterLabel(selCounter))} this month.</td></tr>`;

    return `<div class="card">
        <div class="month-summary-header">
          <select class="field" id="repStation" style="max-width:180px;">${stationBtns}</select>
          <input type="month" class="field" id="repMonth" value="${state.reportMonth}" style="max-width:170px;"/>
        </div>
        <h3 style="margin-bottom:8px;">Select a counter</h3>
        <div style="display:flex;flex-wrap:wrap;margin-bottom:6px;">${chips}</div>
        <div class="report-actions">
          <button class="btn btn-ghost btn-sm" id="btnPrintCounterReport">🖨️ Print</button>
          <button class="btn btn-ghost btn-sm" id="btnDownloadCounterReport">⬇ Download CSV</button>
        </div>
        <div class="table-scroll">
          <table class="summary">
            <tr><th>#</th><th style="text-align:left;">Operator</th><th>Days</th><th style="text-align:left;">Shift split</th></tr>
            ${tableRows}
          </table>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:10px;">Ranked highest to lowest days on ${esc(counterLabel(selCounter))} — handy for tallying REST/ L too.</div>
      </div>`;
  }

  async function renderLogTab() {
    const stationBtns = STATIONS.map(s => `<option value="${s.code}" ${state.reportStation === s.code ? 'selected' : ''}>${s.name}</option>`).join('');
    const code = state.reportStation;
    const duty = await getDuty(code, state.date);
    const entries = Object.entries(duty);
    const lines = entries.length ? entries.map(([n, d]) => {
      const shiftTxt = d.shift ? ' · ' + d.shift : '';
      return `<div class="log-entry">
          <div class="li"><div class="op">${esc(n)}</div><div class="meta">${esc(counterLabel(d.counter))}${shiftTxt}</div></div>
          <button class="trash-btn" data-op="${esc(n)}">Delete</button>
        </div>`;
    }).join('') : `<div class="empty">No entries for ${esc(stationOf(code).name)} on this date.</div>`;
    return `<div class="card">
        <div class="month-summary-header">
          <select class="field" id="logStation" style="max-width:180px;">${stationBtns}</select>
          <input type="date" class="field" id="logDate" value="${state.date}" style="max-width:170px;"/>
        </div>
        ${lines}
      </div>`;
  }

  async function renderSettingsTab() {
    const ownerPin = await getOwnerPin();
    const pinRows = [];
    for (const s of STATIONS) {
      const pin = await getStationPin(s.code);
      pinRows.push(`<div class="op-row">
          <div><div class="op-name">${esc(s.name)} (${s.code})</div><div style="font-size:12px;color:var(--muted);margin-top:2px;">Current PIN: <b>${esc(pin)}</b></div></div>
          <div class="row-flex" style="gap:6px;">
            <input class="field" style="width:90px;padding:7px 8px;" id="pin_${s.code}" type="password" inputmode="numeric" maxlength="8" placeholder="New"/>
            <button class="btn btn-primary btn-sm" data-savestationpin="${s.code}">Save</button>
          </div>
        </div>`);
    }
    return `<div class="card">
        <h3>Change owner PIN</h3>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Current PIN: <b>${esc(ownerPin)}</b></div>
        <div class="row-flex">
          <input class="field" id="newPin" type="password" inputmode="numeric" maxlength="8" placeholder="New PIN"/>
          <button class="btn btn-primary" id="btnSavePin">Save</button>
        </div>
      </div>
      <div class="card">
        <h3>Admin PINs</h3>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px;">Each station's PIN is visible only to you and that station's admin.</div>
        ${pinRows.join('')}
      </div>
      <div class="card">
        <h3>About</h3>
        <div style="font-size:13px;color:var(--muted);line-height:1.5;">
          Admins at each station unlock with their own PIN, then add operators and save duty for any date — past, today, or planned ahead. Once a duty entry is saved it locks —
          only here, in the Owner Console, can it be deleted. Data is stored in Firestore and refreshes automatically every few seconds while this app is open.
        </div>
      </div>`;
  }

  function bindOwner() {
    document.getElementById('btnBack').addEventListener('click', () => { stopPoll(); state.screen = 'home'; render(); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); }));

    if (state.tab === 'report') {
      document.getElementById('repStation').addEventListener('change', e => { state.reportStation = e.target.value; render(); });
      document.getElementById('repMonth').addEventListener('change', e => { state.reportMonth = e.target.value; render(); });
      document.getElementById('btnPrintReport').addEventListener('click', printReport);
      document.getElementById('btnDownloadReport').addEventListener('click', downloadReportCSV);
    }
    if (state.tab === 'counter') {
      document.getElementById('repStation').addEventListener('change', e => { state.reportStation = e.target.value; render(); });
      document.getElementById('repMonth').addEventListener('change', e => { state.reportMonth = e.target.value; render(); });
      document.querySelectorAll('[data-counter]').forEach(b => b.addEventListener('click', () => { state.selectedCounter = b.dataset.counter; render(); }));
      document.getElementById('btnPrintCounterReport').addEventListener('click', printCounterReport);
      document.getElementById('btnDownloadCounterReport').addEventListener('click', downloadCounterReportCSV);
    }
    if (state.tab === 'log') {
      document.getElementById('logStation').addEventListener('change', e => { state.reportStation = e.target.value; render(); });
      document.getElementById('logDate').addEventListener('change', e => { state.date = e.target.value; render(); });
      document.querySelectorAll('.trash-btn').forEach(b => b.addEventListener('click', async () => {
        const op = b.dataset.op;
        if (!confirm('Delete duty entry for ' + op + '? This cannot be undone.')) return;
        const code = state.reportStation;
        const duty = await getDuty(code, state.date);
        delete duty[op];
        await saveDuty(code, state.date, duty);
        showToast('Deleted entry for ' + op);
        render();
      }));
    }
    if (state.tab === 'settings') {
      document.getElementById('btnSavePin').addEventListener('click', async () => {
        const val = document.getElementById('newPin').value.trim();
        if (val.length < 4) { showToast('PIN must be at least 4 digits'); return; }
        await setOwnerPin(val);
        showToast('PIN updated');
        render();
      });
      document.querySelectorAll('[data-savestationpin]').forEach(b => b.addEventListener('click', async () => {
        const code = b.dataset.savestationpin;
        const input = document.getElementById('pin_' + code);
        const val = input.value.trim();
        if (val.length < 4) { showToast('PIN must be at least 4 digits'); return; }
        await setStationPin(code, val);
        showToast(code + ' PIN updated');
        render();
      }));
    }
  }

  // ---------- report print / export ----------
  function printReport() {
    if (!lastReport) { showToast('Nothing to print yet'); return; }
    const { stationName, month, cols, rowsData } = lastReport;
    const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const theadCols = cols.map(c => `<th>${esc(counterLabel(c))}</th>`).join('');
    const tbody = rowsData.length ? rowsData.map(r => {
      const [op, ...vals] = r;
      const total = vals[vals.length - 1];
      const mids = vals.slice(0, -1).map(v => `<td>${v || '—'}</td>`).join('');
      return `<tr><td style="text-align:left;font-weight:700;">${esc(op)}</td>${mids}<td style="font-weight:800;">${total}</td></tr>`;
    }).join('') : `<tr><td colspan="${cols.length + 2}">No data</td></tr>`;
    document.getElementById('printArea').innerHTML = `
      <div class="print-only" style="font-family:Arial,sans-serif;padding:24px;">
        <h2 style="margin:0 0 2px;">${esc(stationName)} — Duty Roster Monthly Report</h2>
        <div style="color:#555;margin-bottom:16px;">${esc(monthLabel)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead><tr style="background:#14213D;color:#fff;">
            <th style="border:1px solid #ccc;padding:5px;text-align:left;">Operator</th>${theadCols}
            <th style="border:1px solid #ccc;padding:5px;">Total days</th>
          </tr></thead>
          <tbody>${tbody.replace(/<td/g, '<td style="border:1px solid #ccc;padding:5px;text-align:center;"')}</tbody>
        </table>
      </div>`;
    setTimeout(() => { window.print(); }, 50);
  }

  function downloadReportCSV() {
    if (!lastReport) { showToast('Nothing to download yet'); return; }
    const { stationName, month, cols, rowsData } = lastReport;
    const headerRow = ['Operator', ...cols.map(counterLabel), 'Total days'];
    const csvLines = [headerRow, ...rowsData].map(r =>
      r.map(cell => {
        const s = String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')
    );
    const csv = csvLines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'duty_report_' + stationName.replace(/\s+/g, '_') + '_' + month + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Report downloaded');
  }

  function printCounterReport() {
    if (!lastCounterReport) { showToast('Nothing to print yet'); return; }
    const { stationName, month, counter, rows } = lastCounterReport;
    const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const tbody = rows.length ? rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td style="text-align:left;font-weight:700;">${esc(r.op)}</td><td style="font-weight:800;">${r.days}</td><td style="text-align:left;">${esc(r.subParts.join(' · '))}</td></tr>`
    ).join('') : `<tr><td colspan="4">No data</td></tr>`;
    document.getElementById('printArea').innerHTML = `
      <div class="print-only" style="font-family:Arial,sans-serif;padding:24px;">
        <h2 style="margin:0 0 2px;">${esc(stationName)} — ${esc(counter)} Duty Ranking</h2>
        <div style="color:#555;margin-bottom:16px;">${esc(monthLabel)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#14213D;color:#fff;">
            <th style="border:1px solid #ccc;padding:5px;">#</th>
            <th style="border:1px solid #ccc;padding:5px;text-align:left;">Operator</th>
            <th style="border:1px solid #ccc;padding:5px;">Days</th>
            <th style="border:1px solid #ccc;padding:5px;text-align:left;">Shift split</th>
          </tr></thead>
          <tbody>${tbody.replace(/<td/g, '<td style="border:1px solid #ccc;padding:5px;text-align:center;"')}</tbody>
        </table>
      </div>`;
    setTimeout(() => { window.print(); }, 50);
  }

  function downloadCounterReportCSV() {
    if (!lastCounterReport) { showToast('Nothing to download yet'); return; }
    const { stationName, month, counter, rows } = lastCounterReport;
    const headerRow = ['Rank', 'Operator', 'Days', 'Shift split'];
    const dataRows = rows.map((r, i) => [i + 1, r.op, r.days, r.subParts.join(' | ')]);
    const csvLines = [headerRow, ...dataRows].map(r =>
      r.map(cell => {
        const s = String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')
    );
    const csv = csvLines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'counter_report_' + counter.replace(/[^a-z0-9]+/gi, '_') + '_' + stationName.replace(/\s+/g, '_') + '_' + month + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Report downloaded');
  }

  // ---------- polling for a "real time" feel ----------
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      // Only auto-refresh on read-only views. Never refresh mid-edit screens
      // (Duty entry, Operators, PIN settings) — doing so would silently wipe
      // any selection the admin hasn't saved yet.
      const safeAdminTabs = ['history'];
      const safeOwnerTabs = ['report', 'counter', 'log'];
      if (state.screen === 'admin' && safeAdminTabs.includes(state.tab)) render();
      else if (state.screen === 'owner' && safeOwnerTabs.includes(state.tab)) render();
    }, 6000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  render();
})();
