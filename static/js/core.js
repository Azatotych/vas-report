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
  openCat: null,
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

// ─── USER NAME HELPERS ──────────────────────────────────────────────────────
function _initials(u) {
  const a = ((u.last_name || u.username || '?').trim()[0]) || '?';
  const fp = (u.first_patronymic || '').trim();
  return (a + (fp ? fp[0] : '')).toUpperCase();
}
function _shortName(u) {
  const ln = u.last_name || '';
  const ini = (u.first_patronymic || '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + '.').join(' ');
  return (ln + (ini ? ' ' + ini : '')) || u.username || '—';
}
function _roleLabel(role) {
  return role === 'admin' ? 'Администратор' : (role === 'supervisor' ? 'Начальник' : 'Сотрудник');
}
function _isManagerRole(role) {
  return role === 'supervisor' || role === 'admin';
}

// ─── SESSION ──────────────────────────────────────────────────────────────────
function showLoginScreen(message = '') {
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  const modal = document.getElementById('password-modal');
  if (modal) modal.style.display = 'none';
  const msg = document.getElementById('login-msg');
  if (msg) {
    msg.textContent = message;
    msg.style.display = message ? '' : 'none';
  }
  const password = document.getElementById('login-password');
  if (password) password.value = '';
  setTimeout(() => {
    const username = document.getElementById('login-username');
    if (username && !username.value) username.focus();
    else if (password) password.focus();
  }, 20);
}

async function loginWithPassword(event) {
  if (event) event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('login-msg');
  const btn = document.getElementById('login-submit');
  if (!username || !password) {
    msg.textContent = 'Введите логин и пароль';
    msg.style.display = '';
    return;
  }
  btn.disabled = true;
  msg.style.display = 'none';
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).catch(() => null);
  btn.disabled = false;
  if (!response) {
    msg.textContent = 'Сервер недоступен';
    msg.style.display = '';
    return;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    msg.textContent = typeof data.detail === 'string' ? data.detail : 'Неверный логин или пароль';
    msg.style.display = '';
    return;
  }
  state.currentUser = data.user;
  state.profile = data.user;
  document.getElementById('login-password').value = '';
  document.getElementById('login-screen').style.display = 'none';
  if (data.user.must_change_password) openPasswordModal(true);
  else initApp();
}

async function logout() {
  await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
  state.currentUser = null;
  state.profile = {};
  state.addedItems = [];
  state.confirmations = {};
  state.rework = null;
  closePasswordModal(true);
  if (typeof renderReworkBanner === 'function') renderReworkBanner();
  showLoginScreen();
}

function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = '';

  const u = state.currentUser || {};
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const iconEl = document.getElementById('sidebar-user-icon');
  if (nameEl) nameEl.textContent = _shortName(u);
  if (roleEl) roleEl.textContent = _roleLabel(u.role);
  if (iconEl) iconEl.textContent = _initials(u);

  const show = ids => ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
  const hide = ids => ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  // Личные разделы сотрудника (Депозитарий доступен обеим ролям — вид свой)
  const personal = ['nav-section-reports', 'nav-submit', 'nav-archive', 'nav-stats', 'nav-section-plan', 'nav-plan'];
  // Разделы начальника
  const management = ['nav-section-supervisor', 'nav-dashboard', 'nav-employees'];

  if (_isManagerRole(u.role)) {
    hide(personal);
    show(management);
    nav('dashboard');
  } else {
    show(personal);
    hide(management);
    loadActiveOrders();
    renderCategories();
  }
  if (typeof loadNotifications === 'function') loadNotifications();
}

// ─── INIT ──────────────────────────────────────────────────────────────────
window.onload = async function() {
  // Отчёт подаётся только за ТЕКУЩИЙ месяц — период зафиксирован (read-only).
  const now = new Date();
  const ms = document.getElementById('report-month');
  const ys = document.getElementById('report-year');
  const cm = now.getMonth() + 1, cy = now.getFullYear();
  ms.innerHTML = `<option value="${cm}" selected>${MONTHS[cm]}</option>`;
  ys.innerHTML = `<option value="${cy}" selected>${cy}</option>`;
  ms.disabled = true;
  ys.disabled = true;
  updateScore();
  if (typeof loadVersion === 'function') loadVersion();

  try {
    const me = await fetch('/api/me').then(r => {
      if (!r.ok) throw new Error('not logged in');
      return r.json();
    });
    state.currentUser = me;
    state.profile = me;
    if (me.must_change_password) {
      document.getElementById('login-screen').style.display = 'none';
      openPasswordModal(true);
    } else {
      initApp();
    }
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
    const detail = typeof e.detail === 'object' ? (e.detail.message || 'Ошибка') : e.detail;
    if (r.status === 403 && detail === 'Необходимо изменить временный пароль') {
      openPasswordModal(true);
    }
    throw new Error(detail || 'Ошибка');
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

// ─── TOAST ─────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, ms = 2600) {
  const t = document.getElementById('wip-toast');
  if (!t) return;
  t.innerHTML = msg;
  t.style.display = '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.display = 'none'; }, ms);
}
function wip() { toast(ic('wrench') + ' Этот раздел в разработке', 2000); }

// ─── NAVIGATION ────────────────────────────────────────────────────────────
const CHIEF_SCREENS = ['dashboard', 'employees', 'review', 'deposits', 'orders', 'profile'];
const EMP_SCREENS = ['submit', 'archive', 'stats', 'deposits', 'orders', 'profile'];  // 'plan' — раздел в доработке, временно отключён

function nav(screen) {
  // Роль определяет доступ к экранам: личные недоступны начальнику и наоборот.
  const role = (state.currentUser || {}).role;
  const manager = _isManagerRole(role);
  const allowed = manager ? CHIEF_SCREENS : EMP_SCREENS;
  if (!allowed.includes(screen)) screen = manager ? 'dashboard' : 'submit';

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('screen-' + screen).classList.add('active');
  const navEl = document.getElementById('nav-' + screen);
  if (navEl) navEl.classList.add('active');
  if (screen === 'orders') loadOrders();
  if (screen === 'archive') loadArchive();
  if (screen === 'stats') loadStats();
  if (screen === 'profile') loadProfile();
  if (screen === 'submit') { loadActiveOrders(); renderCategories(); if (typeof loadNotifications === 'function') loadNotifications(); if (typeof renderReworkBanner === 'function') renderReworkBanner(); }
  if (screen === 'deposits') loadDeposits();
  if (screen === 'plan') loadPlan();
  if (screen === 'dashboard') { loadDashboard(); if (typeof loadNotifications === 'function') loadNotifications(); }
  if (screen === 'employees') loadEmployees();
}

// ─── PASSWORD AND ACTIVE SESSIONS ──────────────────────────────────────────
let _passwordForced = false;

function openPasswordModal(forced = false) {
  _passwordForced = !!forced;
  document.getElementById('password-modal-title').textContent =
    forced ? 'Смените временный пароль' : 'Изменить пароль';
  document.getElementById('password-modal-lead').textContent =
    forced ? 'Для продолжения работы задайте собственный пароль.' : 'Введите текущий пароль и задайте новый.';
  document.getElementById('password-cancel').style.display = forced ? 'none' : '';
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-repeat').value = '';
  document.getElementById('password-msg').innerHTML = '';
  document.getElementById('password-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('pw-current').focus(), 20);
}

function closePasswordModal(force = false) {
  if (_passwordForced && !force) return;
  const modal = document.getElementById('password-modal');
  if (modal) modal.style.display = 'none';
  _passwordForced = false;
}

async function changeOwnPassword() {
  const current = document.getElementById('pw-current').value;
  const next = document.getElementById('pw-new').value;
  const repeat = document.getElementById('pw-repeat').value;
  const msg = document.getElementById('password-msg');
  if (next !== repeat) {
    msg.className = 'err-box';
    msg.textContent = 'Новые пароли не совпадают';
    return;
  }
  try {
    const result = await api('POST', '/account/password', {
      current_password: current,
      new_password: next,
    });
    state.currentUser = result.user;
    state.profile = result.user;
    const forced = _passwordForced;
    closePasswordModal(true);
    if (forced) initApp();
    else showMsg('profile-msg', 'Пароль изменён');
  } catch (e) {
    msg.className = 'err-box';
    msg.textContent = e.message;
  }
}

function _sessionDevice(userAgent) {
  if (!userAgent) return 'Неизвестное устройство';
  if (/Windows/i.test(userAgent)) return 'Рабочая станция Windows';
  if (/Android/i.test(userAgent)) return 'Устройство Android';
  if (/iPhone|iPad/i.test(userAgent)) return 'Устройство Apple';
  return 'Рабочая станция';
}

async function loadAccountSessions() {
  const box = document.getElementById('account-sessions');
  box.style.display = '';
  box.innerHTML = '<div class="empty-state">Загрузка…</div>';
  try {
    const sessions = await api('GET', '/account/sessions');
    box.innerHTML = sessions.map(s => `
      <div class="account-session-row">
        <div>
          <div class="account-session-title">${_sessionDevice(s.user_agent)}${s.current ? ' · текущий сеанс' : ''}</div>
          <div class="account-session-sub">IP: ${s.ip_address || '—'} · активность: ${new Date(s.last_seen_at).toLocaleString('ru-RU')}</div>
        </div>
        ${s.current ? '' : `<button class="btn btn-danger btn-sm" onclick="revokeAccountSession(${s.id})">Завершить</button>`}
      </div>`).join('') || '<div class="empty-state">Нет активных сеансов</div>';
  } catch (e) {
    box.innerHTML = `<div class="err-box">${e.message}</div>`;
  }
}

async function revokeAccountSession(id) {
  await api('DELETE', `/account/sessions/${id}`);
  loadAccountSessions();
}

// ─── SCORE ─────────────────────────────────────────────────────────────────
function calcTotal() {
  return state.addedItems.reduce((s, i) => s + (i.pts || 0), 0);
}

function _periodLabel() {
  const m = document.getElementById('report-month');
  const y = document.getElementById('report-year');
  return (m && y) ? `${MONTHS[+m.value]} ${y.value}` : '';
}

function updateScore() {
  const total = round1(calcTotal());
  const over = total > SCORE_CAP;

  const periodEl = document.getElementById('aside-period');
  if (periodEl) periodEl.textContent = `${_periodLabel()} · черновик`;

  document.getElementById('cap-warn').style.display = over ? 'flex' : 'none';

  // Желательное (не обязательное) подтверждение к приказам — баннер-напоминание.
  const ordersNoConfirm = state.addedItems.filter(i => i.type === 'order' && !state.confirmations[i.data.id]).length;
  const confWarn = document.getElementById('order-confirm-warn');
  if (confWarn) {
    confWarn.style.display = ordersNoConfirm ? 'flex' : 'none';
    const t = document.getElementById('order-confirm-warn-text');
    if (t) t.textContent = `Желательно приложить подтверждение к ${ordersNoConfirm > 1 ? ordersNoConfirm + ' приказам' : 'приказу'}.`;
  }

  const totalPts = document.getElementById('added-total-pts');
  totalPts.className = over ? 'aside-total-pts over' : 'aside-total-pts';
  totalPts.innerHTML = `${total} <span style="color:var(--text-5);font-weight:400">/ 30</span>`;

  const progress = document.getElementById('aside-progress');
  progress.style.width = Math.min(100, total / SCORE_CAP * 100) + '%';
  progress.style.background = over ? 'var(--danger)' : 'var(--gold)';

  const list = document.getElementById('added-items-list');
  if (!state.addedItems.length) {
    list.innerHTML = `<div class="submit-aside-empty">
      <div class="submit-aside-empty-icon">∅</div>
      <div class="submit-aside-empty-text">Выберите категорию и заполните данные, чтобы добавить достижение в отчёт</div>
    </div>`;
    return;
  }

  const rw = !!state.rework;   // в доработке кнопка правки заметнее и зовётся «Исправить»
  list.innerHTML = state.addedItems.map(item =>
    `<div class="aside-item${rw ? ' aside-item-rework' : ''}">
      <div class="aside-item-top">
        <span class="aside-item-num">${item.icon}</span>
        <span class="aside-item-label">${item.label}</span>
        <span class="aside-item-pts">+${item.pts}</span>
      </div>
      <div class="aside-item-bot">
        <span class="aside-item-sub">${item.sub || ''}</span>
        <div class="aside-item-actions">
          <button class="${rw ? 'aside-item-fix' : 'aside-item-rm'}" title="Редактировать" onclick="editItem('${item.key}')">${ic('edit')} ${rw ? 'Исправить' : 'Изм.'}</button>
          <button class="aside-item-rm" onclick="removeItem('${item.key}')">${ic('trash')} Удалить</button>
        </div>
      </div>
    </div>`
  ).join('');
}

function editItem(key) {
  const item = state.addedItems.find(i => i.key === key);
  if (!item) return;
  closePanel();
  // make sure the target category is visible regardless of active filter
  if (typeof catFilter !== 'undefined') { catFilter = 'avail'; catQuery = ''; renderCategories(); }

  if (item.type === 'order') {
    openCat(item.data.level === 'higher' ? '30.1' : '30.2');
    state.editingItemKey = key;
    return;
  }

  if (item.type === 'software') {
    openCat('20');
    state.editingItemKey = key;
    setTimeout(() => {
      swMode('manual');
      const d = item.data;
      _fillSwForm(d);
      const btn = document.querySelector('[onclick="addSoftwareToReport()"]');
      if (btn) btn.innerHTML = ic('check') + ' Сохранить изменения';
    }, 50);
    return;
  }

  if (item.type === 'conference') {
    openCat('24');
    state.editingItemKey = key;
    setTimeout(() => {
      document.getElementById('conf-title').value = item.data.title || '';
      _confCertFilename = item.data.certificate_filename || null;
      if (_confCertFilename) {
        const lbl = document.getElementById('conf-cert-label');
        if (lbl) { lbl.className = 'upload-label has-file'; lbl.querySelector('span').innerHTML = ic('paperclip') + ' файл приложен'; }
      }
      const btn = document.querySelector('[onclick="addConferenceToReport()"]');
      if (btn) btn.innerHTML = ic('check') + ' Сохранить изменения';
    }, 50);
    return;
  }

  if (item.type === 'article') {
    const artTypeKey = item.data.article_type;
    const panelType = 'article_' + artTypeKey;
    const artN = artTypeKey === 'vak_rinc' ? '27.1' : (artTypeKey === 'rinc' ? '27.2' : '27.3');
    openCat(artN);
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
      if (btn) btn.innerHTML = ic('check') + ' Сохранить изменения';
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

// ─── PANEL BUILDING (rendered inline inside a category row) ──────────────────
function panelHTML(type) {
  if (type === 'order_higher') return buildOrdersPanel('higher');
  if (type === 'order_academy') return buildOrdersPanel('academy');
  if (type === 'software') return buildSoftwarePanel();
  if (type.startsWith('article_')) return buildArticlePanel(type);
  if (type === 'conference') return buildConferencePanel();
  return '';
}

function panelInit(type) {
  if (type === 'software') { addAuthorRow('', '', 100); return; }
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
  state.openCat = null;
  if (typeof _artDocxFilename !== 'undefined') _artDocxFilename = null;
  if (typeof _confCertFilename !== 'undefined') _confCertFilename = null;
  document.querySelectorAll('.cat-expand').forEach(e => { e.style.display = 'none'; e.innerHTML = ''; });
  document.querySelectorAll('.cat-row.open').forEach(e => e.classList.remove('open'));
}
