const MONTHS = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_GEN = ['','январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];
const WEIGHTS = { order_higher: 7, order_academy: 4, conference: 5, software: 5, article_vak_rinc: 8, article_rinc: 5, article_closed: 5 };
const ART_LABELS = { rinc: 'РИНЦ', vak_rinc: 'ВАК + РИНЦ', closed: 'Закрытое' };
const SCORE_CAP = 30;

let state = {
  addedItems: [],
  editingItemKey: null,
  activeOrders: [],
  confirmations: {},
  currentPanel: null,
  editingOrderId: null,
  archiveReports: [],
  currentUser: null,
  profile: {},
};
let _itemKey = 0;

// ─── SHARED HELPERS ──────────────────────────────────────────────────────────
function round1(n) { return Math.round(n * 10) / 10; }

function sumPct(authors) {
  return (authors || []).reduce((s, a) => s + (a.contribution_percent || 0), 0);
}

function pctToPts(pct, totalPct, maxPts) {
  return totalPct > 0 ? round1((pct || 0) / totalPct * maxPts) : 0;
}

function myPointsFrom(authors, ptsKey) {
  const ln = (state.profile.last_name || '').toLowerCase().trim();
  if (!ln) return 0;
  return (authors || []).filter(a => (a.full_name || '').toLowerCase().includes(ln))
    .reduce((s, a) => s + (parseFloat(a[ptsKey]) || 0), 0);
}

function noMyPointsMsg() {
  const ln = state.profile.last_name || '';
  return ln
    ? `Ваша фамилия (${ln}) не найдена среди авторов — баллы не засчитаны`
    : 'Заполните фамилию в профиле для автоматического расчёта баллов';
}

// ─── SESSION ──────────────────────────────────────────────────────────────────
async function showLoginScreen() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';

  const users = await fetch('/api/users/list').then(r => r.json()).catch(() => []);
  const list = document.getElementById('login-user-list');
  list.innerHTML = users.map(u => {
    const isSuper = u.role === 'supervisor';
    const icon = isSuper ? '👨‍💼' : '👤';
    const name = [u.last_name, u.first_patronymic].filter(Boolean).join(' ') || u.username;
    const roleLabel = isSuper ? 'Начальник' : 'Сотрудник';
    const sub = [roleLabel, u.position].filter(Boolean).join(' · ');
    return `<button class="user-login-btn" onclick="selectUser(${u.id})">
      <span class="user-login-icon">${icon}</span>
      <div class="user-login-info">
        <div class="user-login-name">${name}</div>
        <div class="user-login-role">${sub}</div>
      </div>
      <span class="user-login-arrow">›</span>
    </button>`;
  }).join('');
}

async function selectUser(userId) {
  const r = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  }).then(r => r.json()).catch(() => null);
  if (!r || !r.ok) { alert('Ошибка входа'); return; }
  state.currentUser = r.user;
  state.profile = r.user;
  document.getElementById('login-screen').style.display = 'none';
  initApp();
}

async function logout() {
  await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
  state.currentUser = null;
  state.profile = {};
  state.addedItems = [];
  state.confirmations = {};
  showLoginScreen();
}

function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = '';

  const u = state.currentUser || {};
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const iconEl = document.getElementById('sidebar-user-icon');
  if (nameEl) nameEl.textContent = u.last_name || u.username || '—';
  if (roleEl) roleEl.textContent = u.role === 'supervisor' ? 'Начальник' : 'Сотрудник';
  if (iconEl) iconEl.textContent = u.role === 'supervisor' ? '👨‍💼' : '👤';

  if (u.role === 'supervisor') {
    ['nav-section-supervisor', 'nav-employees'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    ['nav-section-reports', 'nav-submit', 'nav-archive', 'nav-stats', 'nav-section-refs', 'nav-orders'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    nav('employees');
  } else {
    loadActiveOrders();
  }
}

// ─── INIT ──────────────────────────────────────────────────────────────────
window.onload = async function() {
  const now = new Date();
  const ms = document.getElementById('report-month');
  const ys = document.getElementById('report-year');
  for (let i = 1; i <= 12; i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = MONTHS[i];
    if (i === now.getMonth() + 1) o.selected = true;
    ms.appendChild(o);
  }
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === now.getFullYear()) o.selected = true;
    ys.appendChild(o);
  }

  try {
    const me = await fetch('/api/me').then(r => {
      if (!r.ok) throw new Error('not logged in');
      return r.json();
    });
    state.currentUser = me;
    state.profile = me;
    initApp();
  } catch {
    showLoginScreen();
  }
};

// ─── API ───────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  if (r.status === 401) {
    state.currentUser = null;
    showLoginScreen();
    throw new Error('Сессия истекла — войдите снова');
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Ошибка сервера' }));
    throw new Error(e.detail || 'Ошибка');
  }
  return r.json();
}

function showMsg(id, text, type = 'ok') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = type === 'ok' ? 'ok-box' : (type === 'warn' ? 'warn-box' : 'err-box');
  el.textContent = text;
  el.style.display = '';
  clearTimeout(el._msgTimer);
  el._msgTimer = setTimeout(() => { el.style.display = 'none'; }, type === 'err' ? 5000 : 4000);
}

// ─── WIP TOAST ─────────────────────────────────────────────────────────────
let wipTimer;
function wip() {
  const t = document.getElementById('wip-toast');
  t.style.display = '';
  clearTimeout(wipTimer);
  wipTimer = setTimeout(() => t.style.display = 'none', 2000);
}

// ─── NAVIGATION ────────────────────────────────────────────────────────────
function nav(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('screen-' + screen).classList.add('active');
  const map = { submit: 0, archive: 1, stats: 2, orders: 3, profile: 4 };
  if (map[screen] !== undefined) document.querySelectorAll('.nav-item')[map[screen]].classList.add('active');
  if (screen === 'orders') { loadOrders(); ordParseMode('upload'); }
  if (screen === 'archive') loadArchive();
  if (screen === 'stats') loadStats();
  if (screen === 'profile') loadProfile();
  if (screen === 'submit') loadActiveOrders();
  if (screen === 'employees') loadEmployees();
  // highlight employees nav separately (not in the numbered map)
  if (screen === 'employees') {
    const el = document.getElementById('nav-employees');
    if (el) el.classList.add('active');
  }
}

// ─── SCORE ─────────────────────────────────────────────────────────────────
function calcTotal() {
  return state.addedItems.reduce((s, i) => s + (i.pts || 0), 0);
}

function updateScore() {
  const total = calcTotal();
  const numEl = document.getElementById('score-num');
  numEl.textContent = total;
  numEl.className = total > SCORE_CAP ? 'score-num over' : 'score-num';
  document.getElementById('cap-warn').style.display = total > SCORE_CAP ? '' : 'none';

  const card = document.getElementById('added-card');
  const list = document.getElementById('added-items-list');
  const totalPts = document.getElementById('added-total-pts');

  if (!state.addedItems.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  totalPts.textContent = total;
  totalPts.className = total > SCORE_CAP ? 'total-pts over' : 'total-pts';

  list.innerHTML = state.addedItems.map(item =>
    `<div class="item-row">
      <span class="item-icon">${item.icon}</span>
      <div class="item-info">
        <div class="item-label">${item.label}</div>
        ${item.sub ? `<div class="item-sub">${item.sub}</div>` : ''}
      </div>
      <span class="item-pts">+${item.pts} б.</span>
      <button class="btn btn-secondary btn-sm btn-icon" title="Редактировать" onclick="editItem('${item.key}')">✏</button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="removeItem('${item.key}')">✕</button>
    </div>`
  ).join('');
}

function editItem(key) {
  const item = state.addedItems.find(i => i.key === key);
  if (!item) return;
  closePanel();

  if (item.type === 'order') {
    openPanel(item.data.level === 'higher' ? 'order_higher' : 'order_academy');
    state.editingItemKey = key;
    return;
  }

  if (item.type === 'software') {
    openPanel('software');
    state.editingItemKey = key;
    setTimeout(() => {
      swMode('manual');
      const d = item.data;
      document.getElementById('sw-title').value = d.title || '';
      document.getElementById('sw-cert').value = d.certificate_number || '';
      document.getElementById('sw-date').value = d.registration_date ? isoDate(d.registration_date) : '';
      document.getElementById('sw-output').value = d.output_data || '';
      const tbody = document.getElementById('sw-authors-body');
      if (tbody) { tbody.innerHTML = ''; (d.authors || []).forEach(a => addAuthorRow(a.full_name, a.position, a.contribution_percent)); }
      setTimeout(() => {
        const ptsRows = document.querySelectorAll('#sw-pts-rows .pts-row-item');
        const ptsMap = {};
        (d.authors || []).forEach(a => { ptsMap[a.full_name] = a.points_claimed; });
        ptsRows.forEach(r => { const inp = r.querySelector('input'); inp.value = ptsMap[r.dataset.name] || 0; });
        recalcPts();
      }, 50);
      const btn = document.querySelector('[onclick="addSoftwareToReport()"]');
      if (btn) btn.textContent = '💾 Сохранить изменения';
    }, 50);
    return;
  }

  if (item.type === 'conference') {
    openPanel('conference');
    state.editingItemKey = key;
    setTimeout(() => {
      document.getElementById('conf-title').value = item.data.title || '';
      _confCertFilename = item.data.certificate_filename || null;
      if (_confCertFilename) {
        const lbl = document.getElementById('conf-cert-label');
        if (lbl) { lbl.className = 'upload-label has-file'; lbl.querySelector('span').textContent = '📎 файл приложен'; }
      }
      const btn = document.querySelector('[onclick="addConferenceToReport()"]');
      if (btn) btn.textContent = '💾 Сохранить изменения';
    }, 50);
    return;
  }

  if (item.type === 'article') {
    const artTypeKey = item.data.article_type;
    const panelType = 'article_' + artTypeKey;
    openPanel(panelType);
    state.editingItemKey = key;
    setTimeout(() => {
      artMode('manual');
      document.getElementById('art-title').value = item.data.title || '';
      document.getElementById('art-pub').value = item.data.publication || '';
      _artDocxFilename = item.data.docx_filename || null;
      const tbody = document.getElementById('art-authors-body');
      if (tbody) {
        tbody.innerHTML = '';
        const authors = item.data.author_list || [];
        if (authors.length) {
          authors.forEach(a => addArtAuthorRow(a.full_name, a.points));
        } else {
          const p = state.profile;
          const ini = (p.first_patronymic || '').split(' ').filter(Boolean).map(w => w[0] + '.').join('');
          addArtAuthorRow(p.last_name ? p.last_name + (ini ? ' ' + ini : '') : '', item.data.points_taken || 0);
        }
      }
      const btn = document.querySelector(`[onclick="addArticleToReport('${panelType}')"]`);
      if (btn) btn.textContent = '💾 Сохранить изменения';
    }, 50);
  }
}

function addItem(type, icon, label, sub, pts, data) {
  const key = 'k' + (++_itemKey);
  state.addedItems.push({ key, type, icon, label, sub, pts, data });
  updateScore();
  return key;
}

function removeItem(key) {
  const item = state.addedItems.find(i => i.key === key);
  if (!item) return;
  if (item.type === 'order') {
    const cb = document.getElementById('oc-' + item.data.id);
    if (cb) cb.checked = false;
    const cz = document.getElementById('confirm-zone-' + item.data.id);
    if (cz) cz.style.display = 'none';
    delete state.confirmations[item.data.id];
  }
  state.addedItems = state.addedItems.filter(i => i.key !== key);
  updateScore();
}

// ─── PANEL MANAGEMENT ──────────────────────────────────────────────────────
function openPanel(type) {
  if (state.currentPanel === type) { closePanel(); return; }
  state.editingItemKey = null;
  state.currentPanel = type;

  document.querySelectorAll('.chip-impl').forEach(c => c.classList.remove('active'));
  const c = document.getElementById('chip-' + type);
  if (c) c.classList.add('active');

  const panel = document.getElementById('active-panel');
  const content = document.getElementById('panel-content');
  panel.style.display = '';

  if (type === 'order_higher') content.innerHTML = buildOrdersPanel('higher');
  else if (type === 'order_academy') content.innerHTML = buildOrdersPanel('academy');
  else if (type === 'software') content.innerHTML = buildSoftwarePanel();
  else if (type.startsWith('article_')) content.innerHTML = buildArticlePanel(type);
  else if (type === 'batch') content.innerHTML = buildBatchPanel();
  else if (type === 'conference') content.innerHTML = buildConferencePanel();

  if (type === 'software') addAuthorRow('', '', 100);
  if (type.startsWith('article_')) {
    const p = state.profile;
    const initials = (p.first_patronymic || '').split(' ').filter(Boolean).map(w => w[0] + '.').join('');
    const userName = p.last_name ? p.last_name + (initials ? ' ' + initials : '') : '';
    addArtAuthorRow(userName, WEIGHTS[type] || 5);
  }
}

function closePanel() {
  state.currentPanel = null;
  state.editingItemKey = null;
  if (typeof _artDocxFilename !== 'undefined') _artDocxFilename = null;
  if (typeof _confCertFilename !== 'undefined') _confCertFilename = null;
  document.getElementById('active-panel').style.display = 'none';
  document.querySelectorAll('.chip-impl').forEach(c => c.classList.remove('active'));
}
