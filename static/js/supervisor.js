// ─── EMPLOYEES SCREEN ─────────────────────────────────────────────────────
let _editingUserId = null;
let _editingUser = null;
let _accountUsers = [];

async function loadEmployees() {
  const data = await api('GET', '/supervisor/employees').catch(() => []);
  _accountUsers = data;
  const wrap = document.getElementById('employees-list');
  document.getElementById('employee-archive-area').innerHTML = '';
  if (!data.length) {
    wrap.innerHTML = '<div class="card"><div class="card-body"><div class="empty-state">Нет сотрудников</div></div></div>';
    return;
  }
  wrap.innerHTML = `<div class="emp-list">` + data.map(u => {
    const name = [u.last_name, u.first_patronymic].filter(Boolean).join(' ') || u.username;
    const isEmployee = u.role === 'employee';
    const latest = isEmployee && u.reports && u.reports[0];
    const pts = latest ? (latest.total_points || 0) : 0;
    const pct = Math.min(100, pts / SCORE_CAP * 100);
    const status = latest ? latest.status : 'none';
    const meta = (typeof _DASH_STATUS !== 'undefined' && _DASH_STATUS[status]) || { label: 'Не подан', dot: 'var(--text-5)' };
    const quick = isEmployee && latest && latest.status === 'submitted'
      ? `<button class="btn btn-primary btn-sm" onclick="approveReport(${latest.id},'employees')">${ic('check')}</button>
         <button class="btn btn-danger btn-sm" onclick="openRejectModal(${latest.id},'employees')">${ic('close')}</button>` : '';
    const open = isEmployee && latest
      ? `<button class="btn btn-secondary btn-sm" onclick="openReview(${latest.id},'employees')">Открыть</button>` : '';
    const badges = [
      `<span class="account-badge">${_roleLabel(u.role)}</span>`,
      !u.active ? '<span class="account-badge danger">отключён</span>' :
      (u.locked_until ? '<span class="account-badge danger">заблокирован</span>' :
      (u.must_change_password ? '<span class="account-badge warn">временный пароль</span>' :
      '<span class="account-badge ok">активен</span>')),
    ].join('');
    return `<div class="emp-row">
      <div class="rank-avatar">${_initials(u)}</div>
      <div class="emp-name"><div>${name}</div><div class="rank-sub">${u.rank || u.position || '—'} · ${u.username}</div><div class="account-badges">${badges}</div></div>
      <div class="emp-bar-wrap">${isEmployee ? `<div class="rank-bar" style="width:${pct}%;background:${pts > SCORE_CAP ? 'var(--danger)' : 'var(--gold)'}"></div>` : ''}</div>
      <div class="rank-pts">${isEmployee ? `${round1(pts)}<span style="color:var(--text-5)">/30</span>` : '—'}</div>
      <div class="emp-reports">${isEmployee ? `${u.reports ? u.reports.length : 0} отч.` : 'система'}</div>
      <div class="emp-status">${isEmployee ? `<span class="status-dot" style="background:${meta.dot}"></span>${meta.label}` : (u.last_login_at ? 'вход выполнен' : 'не входил')}</div>
      <div class="emp-actions">
        ${quick}${open}
        <button class="btn btn-secondary btn-sm" onclick="showUserModal(${u.id})" title="Изменить">${ic('edit')}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})" title="Удалить">${ic('trash')}</button>
      </div>
    </div>`;
  }).join('') + `</div>`;
}

async function showEmployeeArchive(userId, name) {
  const area = document.getElementById('employee-archive-area');
  area.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const reports = await api('GET', `/supervisor/users/${userId}/reports`).catch(() => []);
  if (!reports.length) {
    area.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state">У ${name} нет отчётов</div></div></div>`;
    return;
  }
  const chips = reports.map(r =>
    `<button class="month-chip" id="svchip-${r.id}" onclick="showSvArchiveDetail(${r.id})">${MONTHS[r.month]} ${r.year} ${_statusBadge(r.status)}</button>`
  ).join('');
  area.innerHTML = `
    <div class="card" style="margin-top:12px">
      <div class="card-header"><div class="card-title">${ic('folder')} Отчёты: ${name}</div></div>
      <div class="card-body">
        <div class="month-chips" style="margin-bottom:12px">${chips}</div>
        <div id="sv-archive-detail"></div>
      </div>
    </div>`;
  // show first report
  showSvArchiveDetail(reports[0].id);
}

async function showSvArchiveDetail(id) {
  document.querySelectorAll('[id^="svchip-"]').forEach(c => c.classList.remove('active'));
  const chip = document.getElementById('svchip-' + id);
  if (chip) chip.classList.add('active');
  const r = await api('GET', '/reports/' + id).catch(() => null);
  if (!r) return;
  const el = document.getElementById('sv-archive-detail');

  const orderRows = (r.orders || []).map(o => {
    const pts = o.level === 'academy' ? WEIGHTS.order_academy : WEIGHTS.order_higher;
    const cfn = o.confirmation_filename;
    const fileBtn = cfn
      ? `<button class="file-preview-btn" onclick="previewDocx('${cfn}','Подтверждайка №${o.number}')">${ic('paperclip')} подтверждайка</button>` : '';
    return `<div class="score-item"><div><div>${o.level === 'academy' ? 'Задание ВАС' : 'Задание вышестоящего'} · №${o.number}</div><div class="score-desc">${o.title}</div>${fileBtn}</div><div class="score-pts">${pts} б.</div></div>`;
  }).join('');
  const swRows = (r.software || []).map(s => {
    const fileBtn = s.docx_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${s.docx_filename}','Ведомость')">${ic('doc')} ведомость</button>` : '';
    return `<div class="score-item"><div><div>ПО: ${s.title}</div><div class="score-desc">№${s.certificate_number}</div>${fileBtn}</div><div class="score-pts">${s.points_taken} б.</div></div>`;
  }).join('');
  const artRows = (r.articles || []).map(a =>
    `<div class="score-item"><div><div>${a.title}</div><div class="score-desc">${ART_LABELS[a.article_type]} · ${a.publication}</div></div><div class="score-pts">${a.points_taken || 0} б.</div></div>`
  ).join('');
  const confRows = (r.conferences || []).map(c => {
    const fileBtn = c.certificate_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${c.certificate_filename}','Сертификат')">${ic('paperclip')} сертификат</button>` : '';
    return `<div class="score-item"><div><div>${c.title || 'Доклад на конференции'}</div><div class="score-desc">п.24</div>${fileBtn}</div><div class="score-pts">${c.points_taken} б.</div></div>`;
  }).join('');

  const comment = r.supervisor_comment
    ? `<div class="supervisor-comment" style="padding:6px 0">Комментарий: ${r.supervisor_comment}</div>` : '';

  el.innerHTML = `
    <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${_statusBadge(r.status)}
      ${comment}
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" onclick="approveReport(${id},true)">${ic('check')} Утвердить</button>
        <button class="btn btn-danger btn-sm" onclick="openRejectModal(${id},true)">${ic('close')} Отклонить</button>
        <a href="/api/reports/${id}/export" class="btn btn-secondary btn-sm">${ic('download')} .xlsx</a>
        <button class="btn btn-secondary btn-sm" onclick="supervisorDeleteReport(${id})">${ic('trash')}</button>
      </div>
    </div>
    ${orderRows}${swRows}${artRows}${confRows}
    ${!orderRows && !swRows && !artRows && !confRows ? '<div class="empty-state">Нет данных</div>' : ''}
    <div class="total-row" style="margin-top:10px"><span class="total-label">Итого баллов</span><span class="total-pts">${r.total_points}</span></div>`;
}

// ─── APPROVE / REJECT ─────────────────────────────────────────────────────
async function approveReport(id, source) {
  if (!confirm('Утвердить отчёт?')) return;
  try {
    await api('POST', `/supervisor/reports/${id}/approve`, { comment: '' });
    _refreshAfterDecision(id, source);
  } catch (e) { _decisionFailed(e, source); }
}

// Отчёт мог исчезнуть (сотрудник отозвал) или месяц закрылся — без ошибок:
function _decisionFailed(e, source) {
  toast((e && e.message) ? e.message : 'Отчёт больше недоступен');
  source = source === true ? 'sv' : (source || '');
  if (source === 'employees') loadEmployees();
  else if (source === 'review') nav(_reviewBack || 'dashboard');
}

function _refreshAfterDecision(id, source) {
  source = source === true ? 'sv' : (source || '');
  if (source === 'review') openReview(id, _reviewBack);
  else if (source === 'employees') loadEmployees();
  else if (source === 'sv') { if (document.getElementById('svchip-' + id)) showSvArchiveDetail(id); }
  else showArchiveDetail(id);
}

let _rejectSource = '';   // '' (архив) | 'sv' (панель сотрудника) | 'review'

function openRejectModal(id, source) {
  _rejectSource = source === true ? 'sv' : (source || '');
  document.getElementById('reject-report-id').value = id;
  document.getElementById('reject-comment').value = '';
  document.getElementById('reject-modal').style.display = 'flex';
}

function closeRejectModal() {
  document.getElementById('reject-modal').style.display = 'none';
}

async function confirmReject() {
  const id = parseInt(document.getElementById('reject-report-id').value);
  const comment = document.getElementById('reject-comment').value.trim();
  closeRejectModal();
  try {
    await api('POST', `/supervisor/reports/${id}/reject`, { comment });
    _refreshAfterDecision(id, _rejectSource);
  } catch (e) { _decisionFailed(e, _rejectSource); }
}

async function supervisorDeleteReport(id) {
  if (!confirm('Удалить этот отчёт? Действие необратимо.')) return;
  await api('DELETE', `/supervisor/reports/${id}`);
  // reload whatever is showing
  const svDetail = document.getElementById('sv-archive-detail');
  if (svDetail) svDetail.innerHTML = '<div class="empty-state">Отчёт удалён</div>';
  const archDetail = document.getElementById('archive-detail');
  if (archDetail) loadArchive();
}

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────
function showUserModal(user) {
  _editingUser = typeof user === 'number' ? _accountUsers.find(u => u.id === user) : user;
  _editingUserId = _editingUser && _editingUser.id ? _editingUser.id : null;
  const isAdmin = (state.currentUser || {}).role === 'admin';
  document.getElementById('user-modal-title').textContent = _editingUserId ? 'Редактировать аккаунт' : 'Добавить аккаунт';
  document.getElementById('um-username').value = _editingUser ? (_editingUser.username || '') : '';
  document.getElementById('um-role').value = _editingUser ? (_editingUser.role || 'employee') : 'employee';
  document.getElementById('um-role').disabled = !isAdmin;
  document.querySelector('#um-role option[value="admin"]').style.display = isAdmin ? '' : 'none';
  document.querySelector('#um-role option[value="supervisor"]').style.display = isAdmin ? '' : 'none';
  document.getElementById('um-last').value = _editingUser ? (_editingUser.last_name || '') : '';
  document.getElementById('um-fp').value = _editingUser ? (_editingUser.first_patronymic || '') : '';
  document.getElementById('um-pos').value = _editingUser ? (_editingUser.position || '') : '';
  document.getElementById('um-unit').value = _editingUser ? (_editingUser.unit || '') : '';
  document.getElementById('um-rank').value = _editingUser ? (_editingUser.rank || '') : '';
  document.getElementById('um-active').value = _editingUser && !_editingUser.active ? '0' : '1';
  document.getElementById('um-active-wrap').style.display = _editingUserId && isAdmin ? '' : 'none';
  document.getElementById('um-reset-btn').style.display = _editingUserId ? '' : 'none';
  document.getElementById('um-unlock-btn').style.display = _editingUserId && _editingUser.locked_until ? '' : 'none';
  document.getElementById('account-modal-note').textContent = _editingUserId
    ? 'Сброс пароля завершит активные сеансы и потребует задать новый пароль при следующем входе.'
    : 'После создания будет сформирован временный пароль. Сотрудник сменит его при первом входе.';
  document.getElementById('user-modal-msg').innerHTML = '';
  document.getElementById('user-modal').style.display = 'flex';
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
  _editingUserId = null;
  _editingUser = null;
}

async function saveUser() {
  const data = {
    username: document.getElementById('um-username').value.trim(),
    role: document.getElementById('um-role').value,
    last_name: document.getElementById('um-last').value.trim(),
    first_patronymic: document.getElementById('um-fp').value.trim(),
    position: document.getElementById('um-pos').value.trim(),
    unit: document.getElementById('um-unit').value.trim(),
    rank: document.getElementById('um-rank').value.trim(),
    active: document.getElementById('um-active').value === '1',
  };
  if (!data.username) {
    document.getElementById('user-modal-msg').className = 'err-box';
    document.getElementById('user-modal-msg').textContent = 'Укажите логин';
    return;
  }
  try {
    if (_editingUserId) {
      await api('PUT', `/users/${_editingUserId}`, data);
      closeUserModal();
      loadEmployees();
    } else {
      const created = await api('POST', '/users', data);
      closeUserModal();
      showTemporaryPassword(data.username, created.temporary_password);
      loadEmployees();
    }
  } catch(e) {
    document.getElementById('user-modal-msg').className = 'err-box';
    document.getElementById('user-modal-msg').textContent = e.message;
  }
}

async function resetUserPassword() {
  if (!_editingUserId || !_editingUser) return;
  if (!confirm(`Сбросить пароль аккаунта «${_editingUser.username}»? Все его активные сеансы будут завершены.`)) return;
  try {
    const result = await api('POST', `/users/${_editingUserId}/reset-password`, {});
    const username = _editingUser.username;
    closeUserModal();
    showTemporaryPassword(username, result.temporary_password);
    loadEmployees();
  } catch (e) {
    const msg = document.getElementById('user-modal-msg');
    msg.className = 'err-box';
    msg.textContent = e.message;
  }
}

async function unlockUser() {
  if (!_editingUserId) return;
  try {
    await api('POST', `/users/${_editingUserId}/unlock`, {});
    closeUserModal();
    loadEmployees();
    toast('Учётная запись разблокирована');
  } catch (e) {
    const msg = document.getElementById('user-modal-msg');
    msg.className = 'err-box';
    msg.textContent = e.message;
  }
}

function showTemporaryPassword(username, password) {
  document.getElementById('credential-username').textContent = username;
  document.getElementById('credential-password').textContent = password;
  document.getElementById('temporary-password-modal').style.display = 'flex';
}

function closeTemporaryPassword() {
  document.getElementById('credential-password').textContent = '—';
  document.getElementById('temporary-password-modal').style.display = 'none';
}

async function copyTemporaryCredentials() {
  const username = document.getElementById('credential-username').textContent;
  const password = document.getElementById('credential-password').textContent;
  try {
    await navigator.clipboard.writeText(`Логин: ${username}\nВременный пароль: ${password}`);
    toast('Данные для входа скопированы');
  } catch {
    toast('Не удалось скопировать автоматически');
  }
}

async function deleteUser(id) {
  if (!confirm('Удалить аккаунт сотрудника? Его данные останутся в архиве.')) return;
  try {
    await api('DELETE', '/users/' + id);
    loadEmployees();
  } catch(e) {
    alert(e.message);
  }
}
