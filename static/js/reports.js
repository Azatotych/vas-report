// ─── SUBMIT REPORT ─────────────────────────────────────────────────────────
async function submitReport() {
  const month = parseInt(document.getElementById('report-month').value);
  const year = parseInt(document.getElementById('report-year').value);

  if (!state.addedItems.length) {
    showMsg('submit-msg', 'Добавьте хотя бы один элемент в отчёт', 'err');
    return;
  }

  // Лимит 30 не блокирует подачу: в .xlsx уходит фактическая сумма,
  // превышение показывается только красной шкалой в черновике.
  const orders = state.addedItems.filter(i => i.type === 'order');
  const softwareItems = state.addedItems.filter(i => i.type === 'software');
  const articles = state.addedItems.filter(i => i.type === 'article');
  const conferences = state.addedItems.filter(i => i.type === 'conference');

  // Save software to DB. Позиции из Картотеки РИД уже есть в БД (data.id) —
  // не пересоздаём, используем существующую запись; новые (введённые прямо
  // в отчёте) — создаём здесь.
  const swIds = [];
  for (const sw of softwareItems) {
    try {
      let id = sw.data.id;
      // нет id (новое) ИЛИ правили при доработке (_dirty) → (пере)сохраняем, upsert по свидетельству
      if (!id || sw._dirty) { const r = await api('POST', '/software', sw.data); id = r.id; }
      swIds.push({ id, points_claimed: sw.data.points_claimed });
    } catch(e) { showMsg('submit-msg', e.message, 'err'); return; }
  }

  // Save articles to DB (та же логика: депозит → по id, иначе создаём/обновляем)
  const artList = [];
  for (const a of articles) {
    try {
      let id = a.data.id;
      if (!id || a._dirty) { const r = await api('POST', '/articles', { ...a.data, id }); id = r.id; }
      artList.push({ id, points_taken: a.data.points_taken || 0 });
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
    state.rework = null;
    renderReworkBanner();
    closePanel();
    updateScore();
    loadActiveOrders();
  } catch(e) { showMsg('submit-msg', e.message, 'err'); }
}

// ─── ORDERS REGISTRY ───────────────────────────────────────────────────────
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
      pr.innerHTML = `<div class="prt">${ic('check')} Распознано</div>
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
  const body = document.getElementById('orders-table-body');
  const countEl = document.getElementById('orders-count');
  if (countEl) countEl.textContent = `${orders.length} ${_plural(orders.length, 'запись', 'записи', 'записей')}`;
  if (!orders.length) { body.innerHTML = '<div class="empty-state">Нет приказов</div>'; return; }
  body.innerHTML = orders.map(o => {
    const lvl = o.level === 'academy'
      ? '<span class="badge badge-academy">ВАС</span>'
      : '<span class="badge badge-higher">Вышестоящий</span>';
    const term = o.deadline_type === 'monthly' ? 'Ежемес.' : (o.deadline_date || '—');
    const expired = o.expired;
    const status = expired
      ? '<span class="ord-status ord-status-off"><span class="status-dot dot-gray"></span>Истёк</span>'
      : (o.is_active ? '<span class="ord-status ord-status-on"><span class="status-dot dot-green"></span>Активен</span>'
                     : '<span class="ord-status ord-status-off"><span class="status-dot dot-amber"></span>Отключён</span>');
    return `<div class="ord-row"${expired ? ' style="opacity:.55"' : ''}>
      <div style="width:120px">
        <div class="ord-no">№${o.number}</div>
        <div class="ord-date">${o.order_date || ''}</div>
      </div>
      <div style="flex:1;padding-right:14px" class="ord-title">${o.title}</div>
      <div style="width:120px">${lvl}</div>
      <div style="width:96px;text-align:right;font-size:12px;color:var(--text-3)">${term}</div>
      <div style="width:120px;display:flex;justify-content:flex-end">${status}</div>
      <div style="width:70px;display:flex;justify-content:flex-end;gap:4px">
        <button class="btn btn-secondary btn-icon" onclick="editOrder(${JSON.stringify(o).replace(/"/g,'&quot;')})" title="Изменить">${ic('edit')}</button>
        <button class="btn btn-danger btn-icon" onclick="deleteOrder(${o.id})" title="Удалить">${ic('trash')}</button>
      </div>
    </div>`;
  }).join('');
}

function _plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
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

// ─── ОТЗЫВ / ДОРАБОТКА ОТЧЁТА ───────────────────────────────────────────────
function _isCurrentPeriod(year, month) {
  const now = new Date();
  return Number(year) === now.getFullYear() && Number(month) === now.getMonth() + 1;
}

async function reopenReport(id) {
  if (!confirm('Снять поданную версию и вернуть достижения в черновик «Подать отчёт»? После правок сформируйте отчёт заново.')) return;
  let data;
  try {
    data = await api('POST', `/reports/${id}/reopen`);
  } catch (e) { alert(e.message); return; }

  // восстановить период и черновик
  const ms = document.getElementById('report-month');
  const ys = document.getElementById('report-year');
  if (ms) ms.value = data.month;
  if (ys) ys.value = data.year;
  state.addedItems = [];
  state.confirmations = {};

  (data.orders || []).forEach(o => {
    const pts = o.level === 'academy' ? WEIGHTS.order_academy : WEIGHTS.order_higher;
    addItem('order', ic('order'), `Задание ${o.level === 'academy' ? 'ВАС' : 'вышестоящего'} · №${o.number}`, o.title, pts,
      { id: o.id, level: o.level, number: o.number, title: o.title });
    if (o.confirmation_filename) state.confirmations[o.id] = o.confirmation_filename;
  });
  (data.software || []).forEach(s => addItem('software', ic('software'), s.title, `№${s.certificate_number} · ПО (п.20)`, s.points_taken,
    { id: s.id, title: s.title, certificate_number: s.certificate_number, registration_date: s.registration_date,
      output_data: s.output_data, docx_filename: s.docx_filename, authors: s.authors || [], points_claimed: s.points_taken }));
  (data.articles || []).forEach(a => addItem('article', ic('article'), a.title,
    (ART_LABELS[a.article_type] || '') + (a.publication ? ' · ' + a.publication : ''), a.points_taken || 0,
    { id: a.id, title: a.title, publication: a.publication, article_type: a.article_type,
      author_list: a.authors || [], points_taken: a.points_taken || 0 }));
  (data.conferences || []).forEach(c => addItem('conference', ic('conference'), c.title || 'Доклад на конференции', 'п.24', c.points_taken,
    { title: c.title, certificate_filename: c.certificate_filename, points_taken: c.points_taken }));

  // режим доработки — для баннера-подсказки и акцента на кнопке «Исправить»
  state.rework = { period: `${MONTHS[data.month]} ${data.year}`, comment: data.supervisor_comment || '' };

  nav('submit');
  renderReworkBanner();
  updateScore();
}

function renderReworkBanner() {
  const el = document.getElementById('rework-banner');
  if (!el) return;
  if (!state.rework) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const { period, comment } = state.rework;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="rework-banner-head">
      <span class="rework-banner-ic">${ic('reopen', 18)}</span>
      <div>
        <div class="rework-banner-title">Доработка отчёта за ${period}</div>
        ${comment ? `<div class="rework-banner-comment">Замечание начальника: «${comment}»</div>` : ''}
      </div>
    </div>
    <div class="rework-banner-steps">
      <span class="rework-step"><span class="rework-step-n">1</span> Найдите достижение в списке <b>«В этом отчёте»</b> справа</span>
      <span class="rework-step"><span class="rework-step-n">2</span> Нажмите у него кнопку <b class="rework-fix-ref">${ic('edit')} Исправить</b></span>
      <span class="rework-step"><span class="rework-step-n">3</span> Внесите правки и нажмите <b>«Сформировать отчёт»</b></span>
    </div>`;
}

// ─── ARCHIVE ───────────────────────────────────────────────────────────────
// TEST-ONLY: clearArchive/clearOrders — массовая очистка для этапа тестирования.
// Удалить перед продакшеном (вместе с кнопками в index.html и эндпоинтами в main.py).
async function clearArchive() {
  if (!confirm('Удалить всю историю отчётов? Приказы, ПО и статьи останутся, использованные в отчётах ПО/статьи вернутся в картотеку.')) return;
  await api('DELETE', '/reports/all');
  state.archiveReports = [];
  document.getElementById('archive-chips').innerHTML = '';
  document.getElementById('archive-detail').innerHTML = '<div class="empty-state">История отчётов очищена</div>';
  toast(ic('check') + ' История отчётов очищена');
}

async function clearOrders() {
  if (!confirm('Удалить все приказы из реестра? Ссылки на них в поданных отчётах также будут сняты.')) return;
  try {
    await api('DELETE', '/orders/all');
    toast(ic('check') + ' Реестр приказов очищен');
    loadOrders();
    if (typeof loadActiveOrders === 'function') loadActiveOrders();
  } catch (e) { alert(e.message); }
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

const _STATUS_LABEL = { submitted: 'На проверке', approved: 'Утверждён', rejected: 'Отклонён' };
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
  const isSupervisor = state.currentUser && _isManagerRole(state.currentUser.role);

  const orderRows = (r.orders || []).map(o => {
    const pts = o.level === 'academy' ? WEIGHTS.order_academy : WEIGHTS.order_higher;
    const cfn = o.confirmation_filename;
    const fileBtn = cfn
      ? `<button class="file-preview-btn" onclick="previewDocx('${cfn}','Подтверждайка — №${o.number}')">${ic('paperclip')} подтверждайка</button>`
      : '';
    return `<div class="score-item"><div><div>${o.level === 'academy' ? 'Задание ВАС (п.30.2)' : 'Задание вышестоящего (п.30.1)'} · №${o.number}</div><div class="score-desc">${o.title}</div>${fileBtn}</div><div class="score-pts">${pts} б.</div></div>`;
  }).join('');
  const swRows = (r.software || []).map(s => {
    const fileBtn = s.docx_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${s.docx_filename}','Ведомость — ${s.title.replace(/'/g,"\\'")}')">${ic('doc')} ведомость</button>`
      : '';
    return `<div class="score-item"><div><div>ПО: ${s.title}</div><div class="score-desc">№${s.certificate_number}</div>${fileBtn}</div><div class="score-pts">${s.points_taken} б.</div></div>`;
  }).join('');
  const artRows = (r.articles || []).map(a => {
    const pts = a.points_taken || 0;
    return `<div class="score-item"><div><div>${a.title}</div><div class="score-desc">${ART_LABELS[a.article_type]} · ${a.publication}</div></div><div class="score-pts">${pts} б.</div></div>`;
  }).join('');
  const confRows = (r.conferences || []).map(c => {
    const fileBtn = c.certificate_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${c.certificate_filename}','Сертификат — ${(c.title||'').replace(/'/g,"\\'")}')">${ic('paperclip')} сертификат</button>`
      : '';
    return `<div class="score-item"><div><div>${c.title || 'Доклад на конференции'}</div><div class="score-desc">п.24 · Доклад на конференции</div>${fileBtn}</div><div class="score-pts">${c.points_taken} б.</div></div>`;
  }).join('');

  const cnt = (r.orders || []).length + (r.software || []).length + (r.articles || []).length + (r.conferences || []).length;
  const subDate = (r.submitted_at || '').slice(0, 10).split('-').reverse().join('.');

  const rejectBanner = (r.status === 'rejected' && r.supervisor_comment)
    ? `<div style="padding:14px 16px 0"><div class="review-reject-banner"><b>Возвращён с замечанием:</b> ${r.supervisor_comment}</div></div>` : '';

  const supervisorActions = isSupervisor ? `
    <div style="padding:12px 16px;border-bottom:1px solid var(--border)"><div class="supervisor-actions" style="margin-top:0;padding-top:0;border-top:none">
      <button class="btn btn-primary btn-sm" onclick="approveReport(${id})">${ic('check')} Утвердить</button>
      <button class="btn btn-danger btn-sm" onclick="openRejectModal(${id})">${ic('close')} Отклонить</button>
      <button class="btn btn-secondary btn-sm" onclick="supervisorDeleteReport(${id})">${ic('trash')} Удалить</button>
    </div></div>` : '';

  el.innerHTML = `<div class="card">
    <div class="card-header" style="align-items:flex-start">
      <div>
        <div style="font-family:var(--serif);font-size:19px;color:var(--text-1);font-weight:600;display:flex;align-items:center;gap:10px">${MONTHS[r.month]} ${r.year} ${_statusBadge(r.status)}</div>
        <div style="font-size:11.5px;color:var(--text-4);margin-top:5px;font-family:var(--mono)">${subDate ? 'подан ' + subDate + ' · ' : ''}${cnt} ${_plural(cnt, 'достижение', 'достижения', 'достижений')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        ${(!isSupervisor && _isCurrentPeriod(r.year, r.month) && r.status === 'rejected')
          ? `<button class="btn btn-primary btn-sm" onclick="reopenReport(${id})">${ic('edit')} Доработать и отправить заново</button>` : ''}
        ${(!isSupervisor && _isCurrentPeriod(r.year, r.month) && r.status === 'submitted')
          ? `<button class="btn btn-secondary btn-sm" onclick="reopenReport(${id})">${ic('reopen')} Отозвать на доработку</button>` : ''}
        <a href="/api/reports/${id}/export" class="btn btn-secondary btn-sm">${ic('download')} Скачать .xlsx</a>
      </div>
    </div>
    ${rejectBanner}
    ${supervisorActions}
    <div class="card-body" style="padding:0 16px">
      ${orderRows}${swRows}${artRows}${confRows}
      ${!orderRows && !swRows && !artRows && !confRows ? '<div class="empty-state">Нет данных</div>' : ''}
    </div>
    <div class="total-row"><span class="total-label">Итого баллов</span><span class="total-pts">${round1(Math.min(r.total_points || 0, SCORE_CAP))}<span style="color:var(--text-5)"> / 30</span></span></div>
  </div>`;
}

// ─── STATS ─────────────────────────────────────────────────────────────────
async function loadStats() {
  const body = document.getElementById('stats-body');
  const reports = await api('GET', '/reports').catch(() => []);
  if (!reports.length) {
    body.innerHTML = '<div class="card"><div class="card-body"><div class="empty-state">Нет отчётов за выбранный год</div></div></div>';
    return;
  }

  // current year only
  const year = Math.max(...reports.map(r => r.year));
  const yr = reports.filter(r => r.year === year).slice().sort((a, b) => a.month - b.month);
  const capped = v => Math.min(v, SCORE_CAP);

  const sum = yr.reduce((a, r) => a + capped(r.total_points || 0), 0);
  const avg = yr.length ? sum / yr.length : 0;
  const best = yr.reduce((m, r) => (capped(r.total_points || 0) > capped(m.total_points || 0) ? r : m), yr[0]);

  document.querySelector('#screen-stats .topbar-eyebrow').textContent = `Динамика баллов · ${year}`;

  // bars
  const bars = yr.map(r => {
    const v = round1(r.total_points || 0);
    const h = Math.max(4, capped(v) / SCORE_CAP * 100);
    const atCap = v >= SCORE_CAP;
    return `<div class="stat-bar">
      <div class="stat-bar-val">${v}</div>
      <div class="stat-bar-fill" style="height:${h}%;background:${atCap ? 'var(--gold)' : '#3E4654'}"></div>
      <div class="stat-bar-month">${MONTHS[r.month].slice(0, 3).toLowerCase()}</div>
    </div>`;
  }).join('');

  // table (with per-report detail counts)
  const details = await Promise.all(yr.map(r => api('GET', '/reports/' + r.id).catch(() => null)));
  const rows = yr.map((r, i) => {
    const d = details[i] || { orders: [], software: [], articles: [], conferences: [] };
    const cnt = d.orders.length + d.software.length + d.articles.length + (d.conferences ? d.conferences.length : 0);
    const v = round1(r.total_points || 0);
    return `<div class="stat-row">
      <div style="flex:1;font-size:13.5px;color:var(--text-2)">${MONTHS[r.month]} ${r.year}</div>
      <div style="width:110px;text-align:right;font-family:var(--mono);font-size:13.5px;color:var(--text-1)">${v}<span style="color:var(--text-5)">/30</span></div>
      <div style="width:140px;text-align:right;font-size:13px;color:var(--text-3)">${cnt} ${_plural(cnt, 'достижение', 'достижения', 'достижений')}</div>
      <div style="width:150px;display:flex;justify-content:flex-end">${_statusBadge(r.status)}</div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="metric-grid">
      <div class="metric"><div class="metric-label">Сумма за год</div><div class="metric-value">${round1(sum)}</div></div>
      <div class="metric"><div class="metric-label">Среднее / мес.</div><div class="metric-value" style="color:var(--text-1)">${avg.toFixed(1)}</div></div>
      <div class="metric"><div class="metric-label">Лучший месяц</div>
        <div style="font-family:var(--serif);font-size:20px;color:var(--text-1);font-weight:600;margin-top:11px">${MONTHS[best.month]} · <span style="font-family:var(--mono);color:var(--gold-dim)">${round1(best.total_points || 0)}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Баллы по месяцам</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--text-4)">— — — лимит 30</div>
      </div>
      <div class="card-body">
        <div class="stat-chart"><div class="stat-chart-limit"></div>${bars}</div>
      </div>
    </div>
    <div class="card">
      <div class="stat-thead">
        <div style="flex:1">Месяц</div>
        <div style="width:110px;text-align:right">Баллы</div>
        <div style="width:140px;text-align:right">Достижений</div>
        <div style="width:150px;text-align:right">Статус</div>
      </div>
      ${rows}
    </div>`;
}

// ─── PROFILE ───────────────────────────────────────────────────────────────
async function loadProfile() {
  const p = await api('GET', '/profile').catch(() => ({}));
  document.getElementById('p-last').value = p.last_name || '';
  document.getElementById('p-fp').value = p.first_patronymic || '';
  document.getElementById('p-pos').value = p.position || '';
  document.getElementById('p-unit').value = p.unit || '';
  document.getElementById('p-rank').value = p.rank || '';
  _renderProfileHero(p);
}

function _renderProfileHero(p) {
  const u = state.currentUser || {};
  const name = [p.last_name, p.first_patronymic].filter(Boolean).join(' ') || u.username || '—';
  const role = _roleLabel(u.role);
  const sub = [p.rank, role].filter(Boolean).join(' · ');
  const av = document.getElementById('profile-avatar');
  const nm = document.getElementById('profile-hero-name');
  const sb = document.getElementById('profile-hero-sub');
  if (av) av.textContent = _initials({ last_name: p.last_name, first_patronymic: p.first_patronymic, username: u.username });
  if (nm) nm.textContent = name;
  if (sb) sb.textContent = sub;
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
