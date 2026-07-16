// ─── ЭКРАНЫ НАЧАЛЬНИКА: ДАШБОРД + ПРОВЕРКА ОТЧЁТА ───────────────────────────
let _dashY = null, _dashM = null;   // выбранный период
let _dashCurY = null, _dashCurM = null;   // текущий (живой) период

function _periodOptions() {
  const now = new Date();
  _dashCurY = now.getFullYear();
  _dashCurM = now.getMonth() + 1;
  const arr = [];
  let y = _dashCurY, m = _dashCurM;
  for (let i = 0; i < 9; i++) {
    arr.push({ y, m, label: `${MONTHS[m]} ${y}` });
    m--; if (m < 1) { m = 12; y--; }
  }
  return arr;
}

function setDashPeriod(val) {
  const [y, m] = val.split('-').map(Number);
  _dashY = y; _dashM = m;
  loadDashboard();
}

async function loadDashboard() {
  const opts = _periodOptions();
  if (_dashY === null) { _dashY = opts[0].y; _dashM = opts[0].m; }
  const data = await api('GET', `/dashboard?year=${_dashY}&month=${_dashM}`).catch(() => null);
  if (!data) return;
  renderDashboard(data, opts);
}

// Линейные SVG-иконки достижений (в цветах типов — как в токенах хэндоффа)
const _ACH_ICONS = {
  software:    { color: '#5FA8C7', svg: '<rect x="2.5" y="4" width="19" height="14" rx="2"/><path d="M2.5 8h19"/><path d="M8 12l2 2-2 2M13.5 16H16"/>' },
  articles:    { color: '#C9A45A', svg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h4"/>' },
  conferences: { color: '#6FC394', svg: '<path d="M3 3h18"/><path d="M20 3v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V3"/><path d="M12 15v6M8.5 21h7"/>' },
  orders:      { color: '#C0A6D8', svg: '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M9 4.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h5"/>' },
};

const _DASH_STATUS = {
  none:      { label: 'Не подан',     dot: 'var(--text-5)' },
  submitted: { label: 'На проверке',  dot: 'var(--gold)' },
  approved:  { label: 'Утверждён',    dot: '#6FC394' },
  rejected:  { label: 'Отклонён',     dot: 'var(--danger)' },
};

function renderDashboard(data, opts) {
  const s = data.statuses, c = data.counts;
  const isCurrent = (_dashY === _dashCurY && _dashM === _dashCurM);

  const periodSel = `<select class="dash-period" onchange="setDashPeriod(this.value)">${
    opts.map(o => `<option value="${o.y}-${o.m}" ${o.y === _dashY && o.m === _dashM ? 'selected' : ''}>${o.label}</option>`).join('')
  }</select>`;

  const statusCards = [
    { label: 'Сдали отчёт', val: `${s.submitted_count}/${s.total}`, dot: '#6FC394' },
    { label: 'Не сдали', val: s.not_submitted, dot: 'var(--text-5)' },
    { label: 'Ждут проверки', val: s.pending, dot: 'var(--gold)' },
    { label: 'Утверждены', val: s.approved, dot: '#6FC394' },
    { label: 'Отклонены', val: s.rejected, dot: 'var(--danger)' },
  ].map(x => `<div class="dash-stat">
      <div class="dash-stat-top"><span class="status-dot" style="background:${x.dot}"></span><span class="dash-stat-label">${x.label}</span></div>
      <div class="dash-stat-val">${x.val}</div>
    </div>`).join('');

  const achCards = [
    { key: 'software', label: 'Программы ЭВМ', val: c.software },
    { key: 'articles', label: 'Статьи', val: c.articles },
    { key: 'conferences', label: 'Конференции', val: c.conferences },
    { key: 'orders', label: 'Приказы', val: c.orders },
  ].map(x => {
    const ic = _ACH_ICONS[x.key];
    return `<div class="dash-ach">
      <div class="dash-ach-icon" style="color:${ic.color}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ic.svg}</svg></div>
      <div><div class="dash-ach-val">${x.val}</div><div class="dash-ach-label">${x.label}</div></div>
    </div>`;
  }).join('');

  const rows = data.ranking.map((u, i) => {
    const name = [u.last_name, u.first_patronymic].filter(Boolean).join(' ') || u.username;
    const meta = _DASH_STATUS[u.status] || _DASH_STATUS.none;
    const pct = Math.min(100, (u.pts || 0) / SCORE_CAP * 100);
    const openBtn = (isCurrent && u.report_id)
      ? `<button class="btn btn-secondary btn-sm" onclick="openReview(${u.report_id})">Открыть</button>`
      : `<span style="width:1px"></span>`;
    return `<div class="rank-row">
      <div class="rank-num">${i + 1}</div>
      <div class="rank-avatar">${_initials(u)}</div>
      <div class="rank-name"><div>${name}</div><div class="rank-sub">${u.rank || u.position || '—'}</div></div>
      <div class="rank-bar-wrap"><div class="rank-bar" style="width:${pct}%;background:${u.pts > SCORE_CAP ? 'var(--danger)' : 'var(--gold)'}"></div></div>
      <div class="rank-pts">${round1(u.pts || 0)}<span style="color:var(--text-5)">/30</span></div>
      <div class="rank-status"><span class="status-dot" style="background:${meta.dot}"></span>${meta.label}</div>
      <div class="rank-action">${openBtn}</div>
    </div>`;
  }).join('');

  document.getElementById('dash-body').innerHTML = `
    <div class="dash-periodbar">${periodSel}${isCurrent ? '<span class="dash-live">● текущий период</span>' : '<span class="dash-archive">снимок месяца</span>'}</div>
    <div class="dash-section-label">Статус отчётов за месяц</div>
    <div class="dash-stats">${statusCards}</div>
    <div class="dash-section-label">Подано достижений за месяц</div>
    <div class="dash-ach-grid">${achCards}</div>
    <div class="dash-section-label">Рейтинг по баллам</div>
    <div class="rank-list">${rows || '<div class="empty-state">Нет сотрудников</div>'}</div>`;
}

// ─── ПРОВЕРКА ОТЧЁТА ────────────────────────────────────────────────────────
let _reviewReportId = null;
let _reviewBack = 'dashboard';

async function openReview(reportId, back) {
  _reviewReportId = reportId;
  _reviewBack = back || 'dashboard';
  nav('review');
  const r = await api('GET', '/reports/' + reportId).catch(() => null);
  if (!r) { document.getElementById('review-body').innerHTML = '<div class="empty-state">Отчёт не найден</div>'; return; }
  renderReview(r);
}

function renderReview(r) {
  const name = [r.last_name, r.first_patronymic].filter(Boolean).join(' ') || r.username || 'Сотрудник';
  const meta = _DASH_STATUS[r.status] || _DASH_STATUS.submitted;

  const rows = [];
  (r.orders || []).forEach(o => {
    const pts = o.level === 'academy' ? WEIGHTS.order_academy : WEIGHTS.order_higher;
    rows.push(_reviewRow(o.level === 'academy' ? '30.2' : '30.1',
      `${o.level === 'academy' ? 'Задание ВАС' : 'Задание вышестоящего'} · №${o.number} — ${o.title}`,
      o.confirmation_filename, 'Подтверждение', pts));
  });
  (r.software || []).forEach(s => rows.push(_reviewRow('20', `ПО: ${s.title} · №${s.certificate_number}`, s.docx_filename, 'Ведомость', s.points_taken)));
  (r.articles || []).forEach(a => rows.push(_reviewRow(_artNum(a.article_type), `${a.title}${a.publication ? ' · ' + a.publication : ''}`, a.docx_filename, 'Статья', a.points_taken || 0)));
  (r.conferences || []).forEach(c => rows.push(_reviewRow('24', c.title || 'Доклад на конференции', c.certificate_filename, 'Сертификат', c.points_taken)));

  let actions = '';
  if (r.status === 'submitted') {
    actions = `<button class="btn btn-danger btn-sm" onclick="reviewReject()">Вернуть с замечанием</button>
               <button class="btn btn-primary btn-sm" onclick="reviewApprove()">${ic('check')} Утвердить</button>`;
  } else if (r.status === 'rejected') {
    actions = `<button class="btn btn-secondary btn-sm" onclick="reviewReopen()">${ic('reopen')} Вернуть на проверку</button>
               <button class="btn btn-primary btn-sm" onclick="reviewApprove()">${ic('check')} Утвердить</button>`;
  } else if (r.status === 'approved') {
    actions = `<button class="btn btn-secondary btn-sm" onclick="reviewReopen()">${ic('reopen')} Снять утверждение</button>`;
  }
  const comment = r.status === 'rejected' && r.supervisor_comment
    ? `<div class="review-reject-banner"><b>Возвращён с замечанием:</b> ${r.supervisor_comment}</div>` : '';

  document.getElementById('review-body').innerHTML = `
    <div class="review-head">
      <button class="btn btn-secondary btn-sm" onclick="nav('${_reviewBack}')">${ic('back')} Назад</button>
      <div class="rank-avatar" style="width:44px;height:44px">${_initials(r)}</div>
      <div style="flex:1">
        <div class="review-name">${name} <span class="badge-status ${_statusClass(r.status)}">${meta.label}</span></div>
        <div class="review-sub">${r.rank || r.position || ''} · отчёт за ${MONTHS[r.month]} ${r.year}</div>
      </div>
      <a href="/api/reports/${r.id}/export" class="btn btn-secondary btn-sm">${ic('download')} Excel</a>
      ${actions}
    </div>
    ${comment}
    <div class="review-table">
      <div class="review-thead"><div style="width:54px">П.</div><div style="flex:1">Достижение</div><div style="width:150px">Подтверждение</div><div style="width:70px;text-align:right">Баллы</div></div>
      ${rows.join('') || '<div class="empty-state">В отчёте нет позиций</div>'}
    </div>
    <div class="review-total"><span>ИТОГО К НАЧИСЛЕНИЮ</span><span class="review-total-pts">${round1(Math.min(r.total_points || 0, SCORE_CAP))}<span style="color:var(--text-5)">/30</span></span></div>`;
}

function _artNum(t) { return t === 'vak_rinc' ? '27.1' : (t === 'rinc' ? '27.2' : '27.3'); }
function _statusClass(s) { return s === 'approved' ? 'badge-approved' : (s === 'rejected' ? 'badge-rejected' : 'badge-submitted'); }

function _reviewRow(num, title, doc, docLabel, pts) {
  const docBtn = doc
    ? `<button class="file-preview-btn" onclick="previewDocx('${doc}','${(title || '').replace(/'/g, "\\'")}')">${ic('paperclip')} ${docLabel}</button>`
    : '<span style="color:var(--text-5);font-size:11px">—</span>';
  return `<div class="review-row">
    <div style="width:54px;font-family:var(--mono);color:var(--gold-dim);font-size:12px">${num}</div>
    <div style="flex:1;font-size:13px;color:var(--text-2)">${title}</div>
    <div style="width:150px">${docBtn}</div>
    <div style="width:70px;text-align:right;font-family:var(--mono);color:var(--gold-dim)">${round1(pts)}</div>
  </div>`;
}

async function reviewApprove() {
  if (!confirm('Утвердить отчёт?')) return;
  try {
    await api('POST', `/supervisor/reports/${_reviewReportId}/approve`, { comment: '' });
    openReview(_reviewReportId, _reviewBack);
  } catch (e) { _reviewActionFailed(e); }
}
function reviewReject() {
  openRejectModal(_reviewReportId, 'review');
}
async function reviewReopen() {
  if (!confirm('Вернуть отчёт на проверку (снять текущее решение)?')) return;
  try {
    await api('POST', `/supervisor/reports/${_reviewReportId}/reopen`);
    openReview(_reviewReportId, _reviewBack);
  } catch (e) { _reviewActionFailed(e); }
}

// Если отчёт исчез (сотрудник отозвал на доработку) — без ошибок в консоли:
// сообщаем и возвращаемся к списку.
function _reviewActionFailed(e) {
  toast((e && e.message) ? e.message : 'Отчёт больше недоступен');
  nav(_reviewBack || 'dashboard');
}
