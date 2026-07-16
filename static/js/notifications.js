// ─── УВЕДОМЛЕНИЯ НА ГЛАВНОМ ЭКРАНЕ ───────────────────────────────────────────
// Начальник видит поданные на проверку отчёты, сотрудник — возвращённые с
// замечанием и утверждённые. Список живой: меняется статус — пропадает пункт.

function _timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return '';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'только что';
  const min = Math.floor(sec / 60); if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60); if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24); if (day < 30) return `${day} дн назад`;
  return d.toLocaleDateString('ru-RU');
}

async function loadNotifications() {
  const role = (state.currentUser || {}).role;
  const el = document.getElementById(role === 'supervisor' ? 'dash-notif' : 'emp-notif');
  if (!el) return;
  let notes = [];
  try { notes = await api('GET', '/notifications'); } catch (e) { notes = []; }
  if (!notes.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="notif-list">
    <div class="notif-hdr">${ic('bell')} Уведомления <span class="notif-count">${notes.length}</span>
      <button class="notif-clear-all" onclick="dismissAllNotif()">Очистить все</button></div>
    ${notes.map(_renderNotif).join('')}
  </div>`;
}

// Крестик закрытия: stopPropagation, чтобы не сработал переход по карточке.
function _notifClose(n) {
  return `<button class="notif-close" title="Скрыть уведомление"
    onclick="event.stopPropagation(); dismissNotif(${n.report_id}, '${n.kind}')">${ic('close')}</button>`;
}

function _renderNotif(n) {
  const period = `${MONTHS[n.month]} ${n.year}`;
  const ago = _timeAgo(n.when);
  if (n.kind === 'submitted') {
    const name = _shortName(n);
    return `<div class="notif-item notif-info" onclick="openReview(${n.report_id},'dashboard')">
      <span class="notif-ic">${ic('inbox')}</span>
      <div class="notif-body"><div class="notif-title">${name} подал отчёт на проверку</div>
        <div class="notif-sub">${period}${ago ? ' · ' + ago : ''}</div></div>
      <span class="notif-go">${ic('arrowRight')}</span>${_notifClose(n)}</div>`;
  }
  if (n.kind === 'rejected') {
    return `<div class="notif-item notif-warn" onclick="goToArchiveReport(${n.report_id})">
      <span class="notif-ic">${ic('warning')}</span>
      <div class="notif-body"><div class="notif-title">Отчёт за ${period} возвращён с замечанием</div>
        <div class="notif-sub">${n.comment ? '«' + n.comment + '»' : 'нажмите, чтобы открыть и доработать'}</div></div>
      <span class="notif-go">${ic('arrowRight')}</span>${_notifClose(n)}</div>`;
  }
  // approved
  return `<div class="notif-item notif-ok" onclick="goToArchiveReport(${n.report_id})">
    <span class="notif-ic">${ic('check')}</span>
    <div class="notif-body"><div class="notif-title">Отчёт за ${period} утверждён</div>
      <div class="notif-sub">${ago}</div></div>
    <span class="notif-go">${ic('arrowRight')}</span>${_notifClose(n)}</div>`;
}

async function dismissNotif(reportId, kind) {
  try { await api('POST', '/notifications/dismiss', { report_id: reportId, kind }); }
  catch (e) { /* скрытие некритично */ }
  loadNotifications();
}

async function dismissAllNotif() {
  try { await api('POST', '/notifications/dismiss', {}); }
  catch (e) { /* скрытие некритично */ }
  loadNotifications();
}

async function goToArchiveReport(id) {
  nav('archive');
  await loadArchive();
  showArchiveDetail(id);
}

async function loadVersion() {
  try {
    const { version } = await api('GET', '/version');
    const tag = 'v' + version;
    ['login-version', 'sidebar-version'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = tag;
    });
  } catch (e) { /* версия необязательна */ }
}
