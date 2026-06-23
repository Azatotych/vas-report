// ─── SUBMIT REPORT ─────────────────────────────────────────────────────────
async function submitReport() {
  const month = parseInt(document.getElementById('report-month').value);
  const year = parseInt(document.getElementById('report-year').value);

  if (!state.addedItems.length) {
    showMsg('submit-msg', 'Добавьте хотя бы один элемент в отчёт', 'err');
    return;
  }

  const total = calcTotal();
  if (total > SCORE_CAP) {
    if (!confirm(`Суммарный балл (${total}) превышает лимит ${SCORE_CAP}. Сверхлимитные баллы не учитываются. Продолжить?`)) return;
  }

  const orders = state.addedItems.filter(i => i.type === 'order');
  const softwareItems = state.addedItems.filter(i => i.type === 'software');
  const articles = state.addedItems.filter(i => i.type === 'article');
  const conferences = state.addedItems.filter(i => i.type === 'conference');

  // Save software to DB
  const swIds = [];
  for (const sw of softwareItems) {
    try {
      const r = await api('POST', '/software', sw.data);
      swIds.push({ id: r.id, points_claimed: sw.data.points_claimed });
    } catch(e) { showMsg('submit-msg', e.message, 'err'); return; }
  }

  // Save articles to DB
  const artList = [];
  for (const a of articles) {
    try {
      const r = await api('POST', '/articles', a.data);
      artList.push({ id: r.id, points_taken: a.data.points_taken || 0 });
    } catch(e) { showMsg('submit-msg', e.message, 'err'); return; }
  }

  const payload = {
    year, month,
    order_ids: orders.map(i => i.data.id),
    confirmations: state.confirmations,
    software: swIds.map((s, idx) => ({ id: s.id, points_claimed: s.points_claimed, title: softwareItems[idx].data.title })),
    articles: artList,
    conferences: conferences.map(c => ({ title: c.data.title, certificate_filename: c.data.certificate_filename, points_taken: c.data.points_taken })),
  };

  try {
    const result = await api('POST', '/reports/submit', payload);
    window.location.href = `/api/reports/${result.id}/export`;
    showMsg('submit-msg', `Отчёт сформирован! Итого: ${result.total_points} баллов`);
    state.addedItems = [];
    state.confirmations = {};
    closePanel();
    updateScore();
    loadActiveOrders();
  } catch(e) { showMsg('submit-msg', e.message, 'err'); }
}

// ─── ORDERS REGISTRY ───────────────────────────────────────────────────────
function toggleOrdAddArea() {
  const area = document.getElementById('ord-add-area');
  area.style.display = area.style.display === 'none' ? '' : 'none';
  if (area.style.display !== 'none') ordParseMode('upload');
}

function ordParseMode(mode) {
  if (mode === 'manual') {
    document.getElementById('ord-add-area').style.display = 'none';
    showOrderModal();
    return;
  }
  const uz = document.getElementById('ord-upload-zone');
  if (uz) uz.style.display = '';
  document.getElementById('ord-btn-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('ord-btn-manual').classList.toggle('active', mode === 'manual');
}

async function parseOrderFile(input) {
  if (!input.files[0]) return;
  const fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    const d = await (await fetch('/api/orders/parse', { method: 'POST', body: fd })).json();
    const pr = document.getElementById('ord-parse-result');
    if (pr) {
      pr.style.display = '';
      pr.className = 'parse-result';
      pr.innerHTML = `<div class="prt">✓ Распознано</div>
        <div class="parse-field"><span class="parse-key">Номер:</span><span>${d.number || '—'}</span></div>
        <div class="parse-field"><span class="parse-key">Тема:</span><span>${d.title || '—'}</span></div>
        <div class="parse-field"><span class="parse-key">Уровень:</span><span>${d.level === 'academy' ? 'ВАС' : 'Вышестоящий'}</span></div>
        <div class="parse-field"><span class="parse-key">Срок:</span><span>${d.deadline_type === 'monthly' ? 'Ежемесячно' : d.deadline_date || '—'}</span></div>`;
    }
    showOrderModal(d);
  } catch(e) { alert('Ошибка парсинга: ' + e.message); }
}

async function loadOrders() {
  const orders = await api('GET', '/orders').catch(() => []);
  const tbody = document.getElementById('orders-table-body');
  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Нет приказов</td></tr>'; return; }
  tbody.innerHTML = orders.map(o => {
    const lvl = o.level === 'academy'
      ? '<span class="badge badge-academy">ВАС</span>'
      : '<span class="badge badge-higher">Вышестоящий</span>';
    const dl = o.deadline_type === 'monthly' ? 'Ежемесячно' : o.deadline_date;
    const expired = o.expired;
    const statusDot = expired
      ? '<span class="status-dot dot-gray"></span><span style="color:#aaa">Истёк</span>'
      : (o.is_active ? '<span class="status-dot dot-green"></span>Активен' : '<span class="status-dot dot-amber"></span>Отключён');
    return `<tr style="${expired ? 'opacity:.5' : ''}">
      <td><b>№${o.number}</b></td>
      <td>${o.title}</td>
      <td style="color:#555;font-size:12px">${o.executor || '—'}</td>
      <td>${lvl}</td>
      <td>${dl}</td>
      <td>${statusDot}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary btn-sm" onclick="editOrder(${JSON.stringify(o).replace(/"/g,'&quot;')})">✏</button>
        <button class="btn btn-danger btn-sm" onclick="deleteOrder(${o.id})">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function showOrderModal(o) {
  state.editingOrderId = (o && o.id) ? o.id : null;
  document.getElementById('order-modal-title').textContent = (o && o.id) ? 'Редактировать приказ' : 'Добавить приказ';
  document.getElementById('om-number').value = o ? (o.number || '') : '';
  document.getElementById('om-title').value = o ? (o.title || '') : '';
  document.getElementById('om-executor').value = o ? (o.executor || '') : '';
  document.getElementById('om-level').value = o ? (o.level || 'academy') : 'academy';
  document.getElementById('om-deadline-type').value = o ? (o.deadline_type || 'monthly') : 'monthly';
  document.getElementById('om-order-date').value = o ? (o.order_date || '') : '';
  document.getElementById('om-deadline-date').value = o ? (o.deadline_date || '') : '';
  document.getElementById('order-modal-msg').innerHTML = '';
  toggleDeadlineDate();
  document.getElementById('order-modal').style.display = 'flex';
}

function editOrder(o) { showOrderModal(o); }
function closeOrderModal() { document.getElementById('order-modal').style.display = 'none'; }
function toggleDeadlineDate() {
  const t = document.getElementById('om-deadline-type').value;
  document.getElementById('om-deadline-date-wrap').style.display = t === 'date' ? '' : 'none';
}

async function saveOrder() {
  const data = {
    number: document.getElementById('om-number').value.trim(),
    title: document.getElementById('om-title').value.trim(),
    executor: document.getElementById('om-executor').value.trim(),
    level: document.getElementById('om-level').value,
    deadline_type: document.getElementById('om-deadline-type').value,
    order_date: document.getElementById('om-order-date').value || null,
    deadline_date: document.getElementById('om-deadline-date').value || null,
    is_active: 1,
  };
  if (!data.number || !data.title) {
    document.getElementById('order-modal-msg').className = 'err-box';
    document.getElementById('order-modal-msg').textContent = 'Заполните номер и название';
    return;
  }
  try {
    if (state.editingOrderId) await api('PUT', '/orders/' + state.editingOrderId, data);
    else await api('POST', '/orders', data);
    closeOrderModal();
    const area = document.getElementById('ord-add-area');
    if (area) area.style.display = 'none';
    loadOrders();
    loadActiveOrders();
  } catch(e) {
    document.getElementById('order-modal-msg').className = 'err-box';
    document.getElementById('order-modal-msg').textContent = e.message;
  }
}

async function deleteOrder(id) {
  if (!confirm('Удалить этот приказ из реестра?')) return;
  await api('DELETE', '/orders/' + id);
  loadOrders();
  loadActiveOrders();
}

// ─── ARCHIVE ───────────────────────────────────────────────────────────────
async function clearArchive() {
  if (!confirm('Удалить все отчёты из архива?')) return;
  await api('DELETE', '/reports/all');
  state.archiveReports = [];
  document.getElementById('archive-chips').innerHTML = '';
  document.getElementById('archive-detail').innerHTML = '<div class="empty-state">Архив очищен</div>';
}

async function loadArchive() {
  state.archiveReports = await api('GET', '/reports').catch(() => []);
  renderArchiveChips();
  if (state.archiveReports.length) showArchiveDetail(state.archiveReports[0].id);
  else document.getElementById('archive-detail').innerHTML = '<div class="empty-state">Нет отчётов</div>';
}

function renderArchiveChips() {
  const el = document.getElementById('archive-chips');
  if (!state.archiveReports.length) { el.innerHTML = ''; return; }
  el.innerHTML = state.archiveReports.map(r =>
    `<button class="month-chip" id="chip-${r.id}" onclick="showArchiveDetail(${r.id})">${MONTHS[r.month]} ${r.year}</button>`
  ).join('');
  if (state.archiveReports.length) document.getElementById('chip-' + state.archiveReports[0].id).classList.add('active');
}

const _STATUS_LABEL = { submitted: 'На проверке', approved: 'Утверждён ✓', rejected: 'Отклонён' };
const _STATUS_CLASS = { submitted: 'badge-submitted', approved: 'badge-approved', rejected: 'badge-rejected' };

function _statusBadge(status) {
  const s = status || 'submitted';
  return `<span class="badge-status ${_STATUS_CLASS[s] || 'badge-submitted'}">${_STATUS_LABEL[s] || s}</span>`;
}

async function showArchiveDetail(id) {
  document.querySelectorAll('.month-chip').forEach(c => c.classList.remove('active'));
  const chip = document.getElementById('chip-' + id);
  if (chip) chip.classList.add('active');
  const r = await api('GET', '/reports/' + id).catch(() => null);
  if (!r) return;
  const el = document.getElementById('archive-detail');
  const isSupervisor = state.currentUser && state.currentUser.role === 'supervisor';

  const orderRows = (r.orders || []).map(o => {
    const pts = o.level === 'academy' ? WEIGHTS.order_academy : WEIGHTS.order_higher;
    const cfn = o.confirmation_filename;
    const fileBtn = cfn
      ? `<button class="file-preview-btn" onclick="previewDocx('${cfn}','Подтверждайка — №${o.number}')">📎 подтверждайка</button>`
      : '';
    return `<div class="score-item"><div><div>${o.level === 'academy' ? 'Задание ВАС (п.30.2)' : 'Задание вышестоящего (п.30.1)'} · №${o.number}</div><div class="score-desc">${o.title}</div>${fileBtn}</div><div class="score-pts">${pts} б.</div></div>`;
  }).join('');
  const swRows = (r.software || []).map(s => {
    const fileBtn = s.docx_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${s.docx_filename}','Ведомость — ${s.title.replace(/'/g,"\\'")}')">📄 ведомость</button>`
      : '';
    return `<div class="score-item"><div><div>ПО: ${s.title}</div><div class="score-desc">№${s.certificate_number}</div>${fileBtn}</div><div class="score-pts">${s.points_taken} б.</div></div>`;
  }).join('');
  const artRows = (r.articles || []).map(a => {
    const pts = a.points_taken || 0;
    return `<div class="score-item"><div><div>${a.title}</div><div class="score-desc">${ART_LABELS[a.article_type]} · ${a.publication}</div></div><div class="score-pts">${pts} б.</div></div>`;
  }).join('');
  const confRows = (r.conferences || []).map(c => {
    const fileBtn = c.certificate_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${c.certificate_filename}','Сертификат — ${(c.title||'').replace(/'/g,"\\'")}')">📎 сертификат</button>`
      : '';
    return `<div class="score-item"><div><div>${c.title || 'Доклад на конференции'}</div><div class="score-desc">п.24 · Доклад на конференции</div>${fileBtn}</div><div class="score-pts">${c.points_taken} б.</div></div>`;
  }).join('');

  const supervisorComment = r.supervisor_comment
    ? `<div class="supervisor-comment">Комментарий: ${r.supervisor_comment}</div>` : '';

  const supervisorActions = isSupervisor ? `
    <div class="supervisor-actions">
      <button class="btn btn-primary btn-sm" onclick="approveReport(${id})">✓ Утвердить</button>
      <button class="btn btn-danger btn-sm" onclick="openRejectModal(${id})">✕ Отклонить</button>
      <button class="btn btn-secondary btn-sm" onclick="supervisorDeleteReport(${id})">🗑 Удалить</button>
    </div>` : '';

  el.innerHTML = `<div class="card">
    <div class="card-header">
      <div class="card-title">${MONTHS[r.month]} ${r.year} ${_statusBadge(r.status)}</div>
      <a href="/api/reports/${id}/export" class="btn btn-secondary btn-sm">⬇ .xlsx</a>
    </div>
    ${supervisorComment ? `<div style="padding:8px 16px;border-bottom:1px solid #f0f0f0">${supervisorComment}</div>` : ''}
    ${supervisorActions ? `<div style="padding:8px 16px;border-bottom:1px solid #f0f0f0">${supervisorActions}</div>` : ''}
    <div class="card-body" style="padding:0 16px">
      ${orderRows}${swRows}${artRows}${confRows}
      ${!orderRows && !swRows && !artRows && !confRows ? '<div class="empty-state">Нет данных</div>' : ''}
    </div>
    <div class="total-row"><span class="total-label">Итого баллов</span><span class="total-pts">${r.total_points}</span></div>
  </div>`;
}

// ─── STATS ─────────────────────────────────────────────────────────────────
async function loadStats() {
  const reports = await api('GET', '/reports').catch(() => []);
  const totalPts = reports.reduce((a, r) => a + (r.total_points || 0), 0);
  document.getElementById('stats-cards').innerHTML = `
    <div class="metric"><div class="metric-label">Отчётов всего</div><div class="metric-value">${reports.length}</div></div>
    <div class="metric"><div class="metric-label">Последний месяц</div><div class="metric-value">${reports[0] ? reports[0].total_points : 0}</div><div class="metric-sub">баллов</div></div>
    <div class="metric"><div class="metric-label">За всё время</div><div class="metric-value">${totalPts.toFixed(1)}</div><div class="metric-sub">баллов</div></div>`;
  const tbody = document.getElementById('stats-table');
  if (!reports.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Нет данных</td></tr>'; return; }
  const details = await Promise.all(reports.map(r => api('GET', '/reports/' + r.id).catch(() => null)));
  tbody.innerHTML = details.map((d, i) => {
    if (!d) return '';
    const r = reports[i];
    return `<tr><td>${MONTHS[r.month]} ${r.year}</td><td>${d.orders.length}</td><td>${d.software.length}</td><td>${d.articles.length}</td><td><b>${r.total_points}</b></td><td><a href="/api/reports/${r.id}/export" class="btn btn-secondary btn-sm">⬇ xlsx</a></td></tr>`;
  }).join('');
}

// ─── PROFILE ───────────────────────────────────────────────────────────────
async function loadProfile() {
  const p = await api('GET', '/profile').catch(() => ({}));
  document.getElementById('p-last').value = p.last_name || '';
  document.getElementById('p-fp').value = p.first_patronymic || '';
  document.getElementById('p-pos').value = p.position || '';
  document.getElementById('p-unit').value = p.unit || '';
  document.getElementById('p-rank').value = p.rank || '';
}

async function saveProfile() {
  try {
    const data = {
      last_name: document.getElementById('p-last').value,
      first_patronymic: document.getElementById('p-fp').value,
      position: document.getElementById('p-pos').value,
      unit: document.getElementById('p-unit').value,
      rank: document.getElementById('p-rank').value,
    };
    await api('PUT', '/profile', data);
    // keep state.profile in sync
    Object.assign(state.profile, data);
    showMsg('profile-msg', 'Сохранено');
  } catch(e) { showMsg('profile-msg', e.message, 'err'); }
}

// ─── DOCX PREVIEW ─────────────────────────────────────────────────────────
async function previewDocx(filename, label) {
  const modal  = document.getElementById('docx-modal');
  const title  = document.getElementById('docx-modal-title');
  const iframe = document.getElementById('docx-modal-iframe');
  const loader = document.getElementById('docx-modal-loader');
  const dlBtn  = document.getElementById('docx-modal-dl');

  title.textContent = label;
  dlBtn.href = '/api/uploads/' + encodeURIComponent(filename);
  dlBtn.download = filename;
  iframe.src = '';
  iframe.style.display = 'none';
  loader.style.display = 'flex';
  modal.style.display = 'flex';

  const previewUrl = '/api/uploads/' + encodeURIComponent(filename) + '/preview';
  iframe.onload = () => { loader.style.display = 'none'; iframe.style.display = 'block'; };
  iframe.onerror = () => { loader.innerHTML = '<div style="color:red">Ошибка загрузки</div>'; };
  iframe.src = previewUrl;
}

function closeDocxModal() {
  document.getElementById('docx-modal').style.display = 'none';
  document.getElementById('docx-modal-iframe').src = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDocxModal(); });
