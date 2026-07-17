// ─── КАРТОТЕКА РИД (депозитарий) ────────────────────────────────────────────
// Личное хранилище ПО/статей: регистрируются заранее, подаются в отчёт в один
// клик. Данные = существующие записи software/articles (is_used = «подано»).
let bankTab = 'available';   // available | submitted
let bankKind = 'all';        // all | po | article
let bankView = 'tiles';      // tiles | list

function _depFromSoftware(s) {
  const ln = (state.profile.last_name || '').toLowerCase();
  const mine = (s.authors || []).find(a => (a.full_name || '').toLowerCase().includes(ln));
  return {
    type: 'po', id: s.id, title: s.title, num: s.certificate_number || '', reg: s.registration_date || '',
    pts: round1(myPointsFrom(s.authors, 'points_claimed')), contrib: mine ? mine.contribution_percent : null,
    doc: s.docx_filename || '', submitted: !!s.is_used, month: s.used_month, year: s.used_year, raw: s,
  };
}
function _depFromArticle(a) {
  return {
    type: 'article', id: a.id, title: a.title, num: ART_LABELS[a.article_type] || a.article_type,
    reg: (a.created_at || '').slice(0, 10), pts: round1(myPointsFrom(a.author_list, 'points')), contrib: null,
    doc: a.docx_filename || '', submitted: !!a.is_used, month: a.used_month, year: a.used_year,
    article_type: a.article_type, publication: a.publication || '', raw: a,
  };
}

async function loadDeposits() {
  if (_isManagerRole((state.currentUser || {}).role)) return loadChiefDeposits();
  document.getElementById('dep-emp-toolbar').style.display = '';
  document.getElementById('dep-register-btn').style.display = '';
  const clrBtn = document.getElementById('dep-clear-po-btn');
  if (clrBtn) clrBtn.style.display = '';
  const [sw, arts] = await Promise.all([
    api('GET', '/software').catch(() => []),
    api('GET', '/articles').catch(() => []),
  ]);
  state.deposits = [...sw.map(_depFromSoftware), ...arts.map(_depFromArticle)];
  renderDeposits();
}

function setBankTab(t) { bankTab = t; renderDeposits(); }
function setBankKind(k) { bankKind = k; renderDeposits(); }
function setBankView(v) { bankView = v; renderDeposits(); }

function _depInDraft(d) {
  const t = d.type === 'po' ? 'software' : 'article';
  return (state.addedItems || []).some(i => i.type === t && i.data && i.data.id === d.id);
}

function renderDeposits() {
  const all = state.deposits || [];
  const avail = all.filter(d => !d.submitted), subm = all.filter(d => d.submitted);
  document.getElementById('dep-count-available').textContent = avail.length;
  document.getElementById('dep-count-submitted').textContent = subm.length;
  document.getElementById('dep-tab-available').classList.toggle('active', bankTab === 'available');
  document.getElementById('dep-tab-submitted').classList.toggle('active', bankTab === 'submitted');

  const chips = [{ id: 'all', label: 'Все' }, { id: 'po', label: 'Программы ЭВМ' }, { id: 'article', label: 'Статьи' }];
  document.getElementById('dep-filters').innerHTML = chips.map(c =>
    `<button class="filter-chip${bankKind === c.id ? ' active' : ''}" onclick="setBankKind('${c.id}')">${c.label}</button>`
  ).join('');
  document.getElementById('dep-view-tiles').classList.toggle('active', bankView === 'tiles');
  document.getElementById('dep-view-list').classList.toggle('active', bankView === 'list');

  let list = bankTab === 'available' ? avail : subm;
  if (bankKind !== 'all') list = list.filter(d => d.type === bankKind);

  const body = document.getElementById('dep-body');
  if (!list.length) {
    body.innerHTML = `<div class="empty-state">${bankTab === 'available'
      ? 'В картотеке пусто — зарегистрируйте ПО или статью'
      : 'Пока ничего не подано в отчёты'}</div>`;
    return;
  }
  body.innerHTML = bankView === 'tiles' ? _depTiles(list) : _depListTable(list);
}

function _typeTag(d) {
  return d.type === 'po'
    ? '<span class="dep-tag dep-tag-po">Программа ЭВМ</span>'
    : '<span class="dep-tag dep-tag-art">Статья</span>';
}

function _depAction(d) {
  if (d.submitted) {
    const m = d.month ? `${MONTHS[d.month]} ${d.year || ''}`.trim() : '';
    return `<span class="dep-submitted">${ic('check')} Подано${m ? ' · ' + m : ''}</span>`;
  }
  if (_depInDraft(d)) return `<span class="dep-indraft">В черновике</span>`;
  return `<button class="btn btn-primary btn-sm" onclick="depositToReport('${d.type}',${d.id})">Подать в отчёт ${ic('arrowRight')}</button>`;
}

function _docBtn(d) {
  if (!d.doc) return '';
  const t = (d.title || '').replace(/'/g, "\\'");
  return `<button class="file-preview-btn" onclick="previewDocx('${d.doc}','${t}')">${ic('doc')} Документ</button>`;
}

function _depTiles(list) {
  return `<div class="dep-tiles">` + list.map(d => `
    <div class="dep-tile">
      ${!d.submitted ? `<button class="dep-del" title="Удалить из картотеки" onclick="deleteDeposit('${d.type}',${d.id})">${ic('close')}</button>` : ''}
      <div class="dep-tile-top">${_typeTag(d)}<span class="dep-pts">${d.pts} б.</span></div>
      <div class="dep-tile-title">${d.title}</div>
      <div class="dep-tile-meta">${d.num}${d.reg ? ' · ' + d.reg : ''}${d.contrib != null ? ' · вклад ' + d.contrib + '%' : ''}</div>
      <div class="dep-tile-actions">${_docBtn(d) || '<span></span>'}${_depAction(d)}</div>
    </div>`).join('') + `</div>`;
}

function _depListTable(list) {
  return `<div class="dep-list">
    <div class="dep-list-head">
      <div style="width:118px">Тип</div><div style="flex:1">Наименование</div>
      <div style="width:130px">№ / тип</div><div style="width:104px">Регистр.</div>
      <div style="width:64px;text-align:right">Баллы</div><div style="width:210px"></div>
    </div>` + list.map(d => `
    <div class="dep-list-row">
      <div style="width:118px">${_typeTag(d)}</div>
      <div style="flex:1" class="dep-list-title">${d.title}</div>
      <div style="width:130px;font-family:var(--mono);font-size:12px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.num}</div>
      <div style="width:104px;font-size:12px;color:var(--text-4)">${d.reg || '—'}</div>
      <div style="width:64px;text-align:right;font-family:var(--mono);color:var(--gold-dim)">${d.pts}</div>
      <div style="width:210px;display:flex;justify-content:flex-end;gap:8px;align-items:center">
        ${_docBtn(d)}${_depAction(d)}
        ${!d.submitted ? `<button class="dep-del-inline" title="Удалить" onclick="deleteDeposit('${d.type}',${d.id})">${ic('close')}</button>` : ''}
      </div>
    </div>`).join('') + `</div>`;
}

// ── Подать в отчёт (в черновик «Подать отчёт») ──────────────────────────────
function depositToReport(type, id) {
  const d = (state.deposits || []).find(x => x.type === type && x.id === id);
  if (!d || d.submitted) return;
  if (_depInDraft(d)) { toast('Это достижение уже в черновике отчёта'); return; }
  if (type === 'po') {
    const s = d.raw;
    addItem('software', ic('software'), s.title, `№${s.certificate_number} · ПО (п.20)`, d.pts, {
      id: s.id, title: s.title, certificate_number: s.certificate_number, registration_date: s.registration_date,
      output_data: s.output_data, docx_filename: s.docx_filename, authors: s.authors, points_claimed: d.pts,
    });
  } else {
    const a = d.raw;
    addItem('article', ic('article'), a.title, (ART_LABELS[a.article_type] || '') + (a.publication ? ' · ' + a.publication : ''), d.pts, {
      id: a.id, title: a.title, publication: a.publication, article_type: a.article_type, points_taken: d.pts,
      author_list: a.author_list, docx_filename: a.docx_filename,
    });
  }
  toast('Добавлено в черновик — сформируйте отчёт на экране «Подать отчёт»');
  renderDeposits();
}

async function deleteDeposit(type, id) {
  if (!confirm('Удалить достижение из картотеки?')) return;
  try {
    await api('DELETE', (type === 'po' ? '/software/' : '/articles/') + id);
    loadDeposits();
  } catch (e) { alert(e.message); }
}

// ── ВИД НАЧАЛЬНИКА: Статистика / Общий архив ───────────────────────────────
let chiefBankTab = 'archive';   // stats | archive
let chiefKind = 'all';          // all | po | article
let chiefEmp = 'all';
let _chiefDeposits = [];

async function loadChiefDeposits() {
  document.getElementById('dep-emp-toolbar').style.display = 'none';
  document.getElementById('dep-register-btn').style.display = 'none';
  const clrBtn = document.getElementById('dep-clear-po-btn');
  if (clrBtn) clrBtn.style.display = 'none';
  _chiefDeposits = await api('GET', '/supervisor/deposits').catch(() => []);
  renderChiefDeposits();
}

async function clearSoftware() {
  if (!confirm('Удалить все карточки ПО (включая поданные)? Статьи останутся. Ссылки на ПО в поданных отчётах будут сняты.')) return;
  try {
    await api('DELETE', '/software/all');
    toast(ic('check') + ' База ПО очищена');
    loadDeposits();
  } catch (e) { alert(e.message); }
}
function setChiefTab(t) { chiefBankTab = t; renderChiefDeposits(); }
function setChiefKind(k) { chiefKind = k; renderChiefDeposits(); }
function setChiefEmp(e) { chiefEmp = e; renderChiefDeposits(); }

function _ownerName(o) { return o ? ([o.last_name, o.first_patronymic].filter(Boolean).join(' ') || o.username) : '—'; }
function _ownerInit(o) { return o ? _initials(o) : '—'; }

function renderChiefDeposits() {
  const tabs = `<div class="dep-toolbar"><div class="dep-tabs">
      <button class="dep-tab${chiefBankTab === 'stats' ? ' active' : ''}" onclick="setChiefTab('stats')">Статистика</button>
      <button class="dep-tab${chiefBankTab === 'archive' ? ' active' : ''}" onclick="setChiefTab('archive')">Общий архив <span class="dep-tab-count">${_chiefDeposits.length}</span></button>
    </div></div>`;
  document.getElementById('dep-body').innerHTML = tabs + (chiefBankTab === 'stats' ? _chiefStats() : _chiefArchive());
}

function _kindChips(handler) {
  const chips = [{ id: 'all', label: 'Все' }, { id: 'po', label: 'Программы ЭВМ' }, { id: 'article', label: 'Статьи' }];
  return `<div class="dep-filters" style="margin:14px 0">${chips.map(c =>
    `<button class="filter-chip${chiefKind === c.id ? ' active' : ''}" onclick="${handler}('${c.id}')">${c.label}</button>`).join('')}</div>`;
}

function _chiefStats() {
  const all = _chiefDeposits;
  const now = new Date(), cm = now.getMonth() + 1, cy = now.getFullYear();
  const thisMonth = all.filter(d => d.used_month === cm && d.used_year === cy).length;
  const authors = new Set(all.map(d => d.user_id)).size;
  const filtered = chiefKind === 'all' ? all : all.filter(d => d.kind === chiefKind);
  const byAuthor = {};
  filtered.forEach(d => { (byAuthor[d.user_id] = byAuthor[d.user_id] || { owner: d.owner, n: 0 }).n++; });
  const ranking = Object.values(byAuthor).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...ranking.map(r => r.n));

  const kpi = [
    { label: 'Всего подано РИД', val: all.length },
    { label: 'В этом месяце', val: thisMonth },
    { label: 'Активных авторов', val: authors },
  ].map(x => `<div class="metric"><div class="metric-label">${x.label}</div><div class="metric-value">${x.val}</div></div>`).join('');

  const rows = ranking.map((r, i) => `<div class="rank-row">
      <div class="rank-num">${i + 1}</div>
      <div class="rank-avatar">${_ownerInit(r.owner)}</div>
      <div class="rank-name">${_ownerName(r.owner)}</div>
      <div class="rank-bar-wrap"><div class="rank-bar" style="width:${r.n / max * 100}%;background:var(--gold)"></div></div>
      <div class="rank-pts">${r.n}</div>
    </div>`).join('');

  return `<div class="metric-grid" style="margin-top:14px">${kpi}</div>
    ${_kindChips('setChiefKind')}
    <div class="rank-list">${rows || '<div class="empty-state">Нет данных</div>'}</div>`;
}

function _chiefArchive() {
  const empMap = new Map(_chiefDeposits.map(d => [String(d.user_id), d.owner]));
  let list = _chiefDeposits;
  if (chiefKind !== 'all') list = list.filter(d => d.kind === chiefKind);
  if (chiefEmp !== 'all') list = list.filter(d => String(d.user_id) === String(chiefEmp));

  const empOpts = ['<option value="all">Все сотрудники</option>']
    .concat([...empMap.entries()].map(([id, o]) => `<option value="${id}" ${chiefEmp === id ? 'selected' : ''}>${_ownerName(o)}</option>`)).join('');

  const rows = list.map(d => {
    const tag = d.kind === 'po' ? '<span class="dep-tag dep-tag-po">ПО</span>' : '<span class="dep-tag dep-tag-art">Статья</span>';
    const num = d.kind === 'po' ? (d.certificate_number || '') : (ART_LABELS[d.article_type] || '');
    const month = d.used_month ? `${MONTHS[d.used_month]} ${d.used_year || ''}`.trim() : '—';
    const doc = d.docx_filename
      ? `<button class="file-preview-btn" onclick="previewDocx('${d.docx_filename}','${(d.title || '').replace(/'/g, "\\'")}')">${ic('doc')}</button>` : '';
    return `<div class="dep-list-row">
      <div style="width:90px">${tag}</div>
      <div style="flex:1" class="dep-list-title">${d.title}</div>
      <div style="width:170px;display:flex;align-items:center;gap:8px"><span class="rank-avatar" style="width:26px;height:26px;font-size:10px">${_ownerInit(d.owner)}</span><span style="font-size:12px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_ownerName(d.owner)}</span></div>
      <div style="width:130px;font-family:var(--mono);font-size:12px;color:var(--text-4)">${num}</div>
      <div style="width:120px;font-size:12px;color:var(--text-4)">${month}</div>
      <div style="width:48px;display:flex;justify-content:flex-end">${doc}</div>
    </div>`;
  }).join('');

  return `<div class="dep-arch-filters">
      <select class="dash-period" onchange="setChiefEmp(this.value)">${empOpts}</select>
      ${_kindChips('setChiefKind')}
    </div>
    <div class="dep-list">
      <div class="dep-list-head">
        <div style="width:90px">Тип</div><div style="flex:1">Наименование</div>
        <div style="width:170px">Сотрудник</div><div style="width:130px">№ / тип</div>
        <div style="width:120px">Подан</div><div style="width:48px"></div>
      </div>
      ${rows || '<div class="empty-state">Пока ничего не подано</div>'}
    </div>`;
}

// ── Модалка «Зарегистрировать» ──────────────────────────────────────────────
let _regType = 'po';
let _regArtType = 'article_rinc';

function openRegisterModal() {
  document.getElementById('register-modal-msg').innerHTML = '';
  document.getElementById('register-modal').style.display = 'flex';
  setRegType('po');
}
function closeRegisterModal() {
  document.getElementById('register-modal').style.display = 'none';
}
function setRegType(t) {
  _regType = t;
  document.getElementById('reg-type-po').classList.toggle('active', t === 'po');
  document.getElementById('reg-type-article').classList.toggle('active', t === 'article');
  const f = document.getElementById('reg-form');
  if (t === 'po') {
    f.innerHTML = buildSoftwarePanel(true);
    swMode('manual');
    addAuthorRow('', '', 100);
  } else {
    f.innerHTML = `<div class="field" style="margin-bottom:12px"><label>Тип публикации</label>
      <select id="reg-art-type" onchange="_onRegArtType(this.value)">
        <option value="article_vak_rinc">ВАК + РИНЦ (8 б.)</option>
        <option value="article_rinc">РИНЦ (5 б.)</option>
        <option value="article_closed">Закрытое издание (5 б.)</option>
      </select></div>
      <div id="reg-art-form"></div>`;
    document.getElementById('reg-art-type').value = _regArtType;
    _onRegArtType(_regArtType);
  }
}
function _onRegArtType(t) {
  _regArtType = t;
  const w = document.getElementById('reg-art-form');
  w.innerHTML = buildArticlePanel(t, true);
  artMode('manual');
  const p = state.profile;
  const ini = (p.first_patronymic || '').split(' ').filter(Boolean).map(x => x[0] + '.').join('');
  addArtAuthorRow(p.last_name ? p.last_name + (ini ? ' ' + ini : '') : '', WEIGHTS[t] || 5);
}
async function saveRegister() {
  const msg = document.getElementById('register-modal-msg');
  msg.innerHTML = '';
  try {
    let res = null;
    if (_regType === 'po') {
      const data = collectSoftwareData();
      if (!data) return;
      res = await api('POST', '/software', data);
    } else {
      const c = collectArticleData(_regArtType);
      if (!c) return;
      await api('POST', '/articles', c.data);
    }
    closeRegisterModal();
    toast(res && res.already_used
      ? 'Это ПО уже подавалось — оно в архиве «Поданы», в картотеку не добавлено'
      : 'Зарегистрировано в картотеке');
    loadDeposits();
  } catch (e) {
    msg.className = 'err-box';
    msg.textContent = e.message;
  }
}
