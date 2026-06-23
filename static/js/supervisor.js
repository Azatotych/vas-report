// ─── EMPLOYEES SCREEN ─────────────────────────────────────────────────────
let _editingUserId = null;

async function loadEmployees() {
  const data = await api('GET', '/supervisor/employees').catch(() => []);
  const tbody = document.getElementById('employees-table-body');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Нет сотрудников</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(u => {
    const name = [u.last_name, u.first_patronymic].filter(Boolean).join(' ') || u.username;
    const latest = u.reports && u.reports[0];
    const statusCell = latest
      ? `${_statusBadge(latest.status)}`
      : '<span style="color:#aaa;font-size:11px">—</span>';
    return `<tr>
      <td><b>${name}</b><div style="font-size:11px;color:#888">${u.username}</div></td>
      <td style="font-size:12px;color:#555">${u.position || '—'}</td>
      <td style="text-align:center">${u.reports ? u.reports.length : 0}</td>
      <td>${statusCell}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary btn-sm" onclick="showEmployeeArchive(${u.id},'${name.replace(/'/g,"\\'")}')">📁 Архив</button>
        <button class="btn btn-secondary btn-sm" onclick="showUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})">✏</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">✕</button>
      </td>
    </tr>`;
  }).join('');
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
      <div class="card-header"><div class="card-title">📁 Отчёты: ${name}</div></div>
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
      ? `<button class="file-preview-btn" onclick="previewDocx('${cfn}','Подтверждайка №${o.number}')">📎 подтверждайка</button>` : '';
    return `<div class="score-item"><div><div>${o.level === 'academy' ? 'Задание ВАС' : 'Задание вышестоящего'} · №${o.number}</div><div class="score-desc">${o.title}</div>${fileBtn}</div><div class="score-pts">${pts} б.</div></div>`;
  }).join('');
  const swRows = (r.software || []).map(s => {
    const fileBtn = s.docx_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${s.docx_filename}','Ведомость')">📄 ведомость</button>` : '';
    return `<div class="score-item"><div><div>ПО: ${s.title}</div><div class="score-desc">№${s.certificate_number}</div>${fileBtn}</div><div class="score-pts">${s.points_taken} б.</div></div>`;
  }).join('');
  const artRows = (r.articles || []).map(a =>
    `<div class="score-item"><div><div>${a.title}</div><div class="score-desc">${ART_LABELS[a.article_type]} · ${a.publication}</div></div><div class="score-pts">${a.points_taken || 0} б.</div></div>`
  ).join('');
  const confRows = (r.conferences || []).map(c => {
    const fileBtn = c.certificate_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${c.certificate_filename}','Сертификат')">📎 сертификат</button>` : '';
    return `<div class="score-item"><div><div>${c.title || 'Доклад на конференции'}</div><div class="score-desc">п.24</div>${fileBtn}</div><div class="score-pts">${c.points_taken} б.</div></div>`;
  }).join('');

  const comment = r.supervisor_comment
    ? `<div class="supervisor-comment" style="padding:6px 0">Комментарий: ${r.supervisor_comment}</div>` : '';

  el.innerHTML = `
    <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${_statusBadge(r.status)}
      ${comment}
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" onclick="approveReport(${id},true)">✓ Утвердить</button>
        <button class="btn btn-danger btn-sm" onclick="openRejectModal(${id},true)">✕ Отклонить</button>
        <a href="/api/reports/${id}/export" class="btn btn-secondary btn-sm">⬇ .xlsx</a>
        <button class="btn btn-secondary btn-sm" onclick="supervisorDeleteReport(${id})">🗑</button>
      </div>
    </div>
    ${orderRows}${swRows}${artRows}${confRows}
    ${!orderRows && !swRows && !artRows && !confRows ? '<div class="empty-state">Нет данных</div>' : ''}
    <div class="total-row" style="margin-top:10px"><span class="total-label">Итого баллов</span><span class="total-pts">${r.total_points}</span></div>`;
}

// ─── APPROVE / REJECT ─────────────────────────────────────────────────────
async function approveReport(id, fromSvPanel) {
  if (!confirm('Утвердить отчёт?')) return;
  await api('POST', `/supervisor/reports/${id}/approve`, { comment: '' });
  if (fromSvPanel) {
    // refresh chips
    const chip = document.getElementById('svchip-' + id);
    if (chip) showSvArchiveDetail(id);
  } else {
    showArchiveDetail(id);
  }
}

let _rejectFromSvPanel = false;

function openRejectModal(id, fromSvPanel) {
  _rejectFromSvPanel = !!fromSvPanel;
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
  await api('POST', `/supervisor/reports/${id}/reject`, { comment });
  closeRejectModal();
  if (_rejectFromSvPanel) {
    showSvArchiveDetail(id);
  } else {
    showArchiveDetail(id);
  }
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
  _editingUserId = user && user.id ? user.id : null;
  document.getElementById('user-modal-title').textContent = _editingUserId ? 'Редактировать сотрудника' : 'Добавить сотрудника';
  document.getElementById('um-username').value = user ? (user.username || '') : '';
  document.getElementById('um-role').value = user ? (user.role || 'employee') : 'employee';
  document.getElementById('um-last').value = user ? (user.last_name || '') : '';
  document.getElementById('um-fp').value = user ? (user.first_patronymic || '') : '';
  document.getElementById('um-pos').value = user ? (user.position || '') : '';
  document.getElementById('um-unit').value = user ? (user.unit || '') : '';
  document.getElementById('um-rank').value = user ? (user.rank || '') : '';
  document.getElementById('user-modal-msg').innerHTML = '';
  document.getElementById('user-modal').style.display = 'flex';
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
  _editingUserId = null;
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
  };
  if (!data.username) {
    document.getElementById('user-modal-msg').className = 'err-box';
    document.getElementById('user-modal-msg').textContent = 'Укажите логин';
    return;
  }
  try {
    if (_editingUserId) {
      await api('PUT', `/users/${_editingUserId}`, data);
    } else {
      await api('POST', '/users', data);
    }
    closeUserModal();
    loadEmployees();
  } catch(e) {
    document.getElementById('user-modal-msg').className = 'err-box';
    document.getElementById('user-modal-msg').textContent = e.message;
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
