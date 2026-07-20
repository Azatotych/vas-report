// ─── ORDERS PANEL ──────────────────────────────────────────────────────────
async function loadActiveOrders() {
  state.activeOrders = await api('GET', '/orders/active').catch(() => []);
  if (state.currentPanel === 'orders') {
    document.getElementById('panel-content').innerHTML = buildOrdersPanel();
  }
}

function buildOrdersPanel(level) {
  const levelLabel = level === 'higher' ? 'Задания вышестоящего (п.30.1)' : 'Задания ВАС (п.30.2)';
  const filtered = state.activeOrders.filter(o => o.level === level);
  if (!filtered.length) {
    return `<div class="panel-title">${levelLabel} <button class="btn btn-secondary btn-sm" onclick="closePanel()">${ic('close')}</button></div>
      <div class="empty-state" style="padding:20px">Нет активных приказов этого уровня. <button class="btn btn-secondary btn-sm" onclick="nav('orders')">Добавить в реестр</button></div>`;
  }
  const rows = filtered.map(o => {
    const alreadyAdded = state.addedItems.find(i => i.type === 'order' && i.data.id === o.id);
    const checked = alreadyAdded ? 'checked' : '';
    const lvlBadge = o.level === 'academy'
      ? '<span class="badge badge-academy">ВАС · 4 б.</span>'
      : '<span class="badge badge-higher">Вышестоящий · 7 б.</span>';
    const dlBadge = o.deadline_type === 'monthly'
      ? '<span class="badge badge-monthly">ежемесячно</span>'
      : `<span class="badge badge-dated">до ${o.deadline_date}</span>`;
    const cfn = state.confirmations[o.id];
    const uploadCls = cfn ? 'upload-label has-file' : 'upload-label';
    const uploadName = cfn ? cfn.split('_').slice(2).join('_') : 'Подтверждайка';
    const showCZ = alreadyAdded ? '' : 'display:none';
    return `<div class="order-row">
      <input type="checkbox" class="order-check" id="oc-${o.id}" ${checked} onchange="toggleOrderItem(${o.id}, this.checked)">
      <div class="order-info">
        <div class="order-name">№${o.number} — ${o.title}</div>
        <div class="order-meta">${o.order_date ? 'от ' + o.order_date : ''}</div>
        <div class="order-badges">${lvlBadge}${dlBadge}</div>
        <div class="confirm-zone" style="${showCZ}" id="confirm-zone-${o.id}">
          <label class="${uploadCls}" id="confirm-label-${o.id}">
            ${ic('paperclip')} <span class="ul-txt">${uploadName}</span>
            <input type="file" accept=".docx,.pdf" style="display:none" onchange="uploadConfirmation(${o.id}, this)">
          </label>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="panel-title">${levelLabel} <button class="btn btn-secondary btn-sm" onclick="closePanel()">${ic('close')} закрыть</button></div>
    <div style="font-size:12px;color:var(--text-4);margin-bottom:10px">Отметьте задания, по которым отчитываетесь в этом месяце</div>
    ${rows}
    <div style="margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="nav('orders')">+ Добавить новый приказ</button></div>`;
}

function toggleOrderItem(id, checked) {
  const order = state.activeOrders.find(o => o.id === id);
  if (!order) return;
  const cz = document.getElementById('confirm-zone-' + id);
  if (checked) {
    if (cz) cz.style.display = '';
    const pts = order.level === 'academy' ? WEIGHTS.order_academy : WEIGHTS.order_higher;
    addItem('order', ic('order'), `№${order.number} — ${order.title}`, order.level === 'academy' ? 'Задание ВАС · п.30.2' : 'Задание вышестоящего · п.30.1', pts, order);
  } else {
    if (cz) { cz.style.display = 'none'; }
    delete state.confirmations[id];
    const item = state.addedItems.find(i => i.type === 'order' && i.data.id === id);
    if (item) { state.addedItems = state.addedItems.filter(i => i.key !== item.key); updateScore(); }
  }
}

async function uploadConfirmation(orderId, input) {
  if (!input.files[0]) return;
  const fd = new FormData();
  fd.append('file', input.files[0]);
  fd.append('order_id', orderId);
  try {
    const r = await fetch('/api/upload/confirmation', { method: 'POST', body: fd });
    const d = await r.json();
    state.confirmations[orderId] = d.filename;
    const lbl = document.getElementById('confirm-label-' + orderId);
    if (lbl) { lbl.className = 'upload-label has-file'; const t = lbl.querySelector('.ul-txt'); if (t) t.textContent = input.files[0].name; }
  } catch(e) { alert('Ошибка загрузки: ' + e.message); }
}

// ─── SOFTWARE PANEL ────────────────────────────────────────────────────────
// embed=true → форма для модалки «Зарегистрировать» (без заголовка с закрытием
// и без кнопки «+ В отчёт» — у модалки своя кнопка сохранения).
function buildSoftwarePanel(embed) {
  return `${embed ? '' : `<div class="panel-title">ПО / Свидетельство ФИПС <button class="btn btn-secondary btn-sm" onclick="closePanel()">${ic('close')} закрыть</button></div>`}
    <div class="mode-toggle">
      <button class="mode-btn" id="sw-btn-upload" onclick="swMode('upload')">${ic('upload')} Загрузить файлы</button>
      <button class="mode-btn active" id="sw-btn-manual" onclick="swMode('manual')">${ic('edit')} Ввести вручную</button>
    </div>
    <div id="sw-upload-zone" style="display:none">
      <div class="upload-zone" onclick="document.getElementById('sw-file-input').click()">
        <div style="margin-bottom:5px;color:var(--gold)">${ic('file',26)}</div>
        Выберите свидетельства ФИПС PDF или «Докладную записку ПО.docx»
        <div style="font-size:11px;color:var(--text-4);margin-top:5px">Можно выбрать до 50 файлов одновременно. В PDF доли не указаны — распределите их вручную для каждой программы.</div>
      </div>
      <input type="file" id="sw-file-input" accept=".docx,.pdf" multiple style="display:none" onchange="parseSoftwareFile(this)">
      <div id="sw-parse-result" style="display:none"></div>
    </div>
    <div id="sw-manual-form" data-embed="${embed ? '1' : '0'}">
      <div class="form-grid" style="margin-bottom:12px">
        <div class="field full"><label>Название ПО</label>
          <input type="text" id="sw-title" placeholder="Название программы"></div>
        <div class="field"><label>Номер свидетельства</label>
          <input type="text" id="sw-cert" placeholder="RU 2026665626"></div>
        <div class="field"><label>Дата регистрации</label>
          <input type="date" id="sw-date"></div>
        <div class="field full"><label>Выходные данные</label>
          <input type="text" id="sw-output" placeholder="Реестр программ для ЭВМ, Роспатент, 2026"></div>
      </div>
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">Авторы</div>
      <table class="authors-table">
        <thead><tr>
          <th>ФИО</th><th>Должность</th>
          <th style="width:80px;text-align:center">Вклад, %</th><th style="width:28px"></th>
        </tr></thead>
        <tbody id="sw-authors-body"></tbody>
      </table>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;gap:10px">
        <button class="add-btn" onclick="addAuthorRow()">+ Автора</button>
        <span class="sw-contrib-sum" id="sw-contrib-sum"></span>
      </div>
      <div class="pts-block" id="sw-pts-block" style="display:none;margin-top:12px">
        <div style="font-size:12px;font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between">
          <span>Баллы (рассчитаны из вклада)</span>
          <span style="color:var(--text-4);font-weight:400">Всего на свидетельство: <b>5</b></span>
        </div>
        <div id="sw-pts-rows"></div>
        <div class="pts-total">
          <span style="color:var(--text-3)">Итого:</span>
          <span id="sw-pts-sum" class="pts-ok">0 / 5</span>
        </div>
      </div>
      ${embed ? '' : `<div style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="addSoftwareToReport()">+ Добавить в отчёт</button>
      </div>`}
    </div>`;
}

function swMode(mode) {
  document.getElementById('sw-upload-zone').style.display = mode === 'upload' ? '' : 'none';
  document.getElementById('sw-manual-form').style.display = mode === 'manual' ? '' : 'none';
  document.getElementById('sw-btn-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('sw-btn-manual').classList.toggle('active', mode === 'manual');
  if (_isSoftwareRegisterMode()) {
    const saveButton = document.getElementById('register-save-btn');
    if (saveButton) saveButton.style.display = mode === 'manual' ? '' : 'none';
  }
}

function addAuthorRow(fio='', pos='', pct=100) {
  const tbody = document.getElementById('sw-authors-body');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" value="${_swEsc(fio)}" placeholder="Иванов И.И." oninput="recalcSwPts()"></td>
    <td><input type="text" value="${_swEsc(pos)}" placeholder="МНС НИО-5"></td>
    <td><input type="number" value="${pct}" min="0" max="100" oninput="recalcSwPts()" style="text-align:center"></td>
    <td><button onclick="this.closest('tr').remove();recalcSwPts()" style="background:none;border:none;cursor:pointer;color:var(--text-5);font-size:14px">${ic('close')}</button></td>`;
  tbody.appendChild(tr);
  recalcSwPts();
}

function round2(n) { return Math.round(n * 100) / 100; }
function _fmtPts(n) { return round2(n).toString(); }

function _swEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function normalizeSoftwareCertificate(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  const match = text.match(/^(?:RU[\s-]*)?(\d{6,})$/i);
  return match ? `RU ${match[1]}` : text;
}

function softwareCertificateKey(value) {
  const normalized = normalizeSoftwareCertificate(value);
  const match = normalized.match(/^RU\s+(\d+)$/i);
  return match ? match[1] : normalized.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
}

function _isSoftwareRegisterMode() {
  return document.getElementById('sw-manual-form')?.dataset.embed === '1';
}

// Баллы ПО ЖЁСТКО связаны с вкладом: балл автора = вклад% / 100 × 5.
// Поля баллов — только для чтения; меняешь % — меняются баллы.
function recalcSwPts() {
  const rows = document.querySelectorAll('#sw-authors-body tr');
  const block = document.getElementById('sw-pts-block');
  const container = document.getElementById('sw-pts-rows');
  const sumEl = document.getElementById('sw-contrib-sum');
  if (!block) return { sumPct: 0, sumPts: 0 };
  if (!rows.length) { block.style.display = 'none'; if (sumEl) sumEl.textContent = ''; return { sumPct: 0, sumPts: 0 }; }
  block.style.display = '';
  let sumPct = 0, sumPts = 0;
  const items = [];
  rows.forEach(r => {
    const name = r.cells[0].querySelector('input').value.trim() || 'Автор';
    const pct = parseFloat(r.cells[2].querySelector('input').value) || 0;
    const pts = round2(pct / 100 * 5);
    sumPct += pct; sumPts += pts;
    items.push({ name, pts });
  });
  sumPct = round2(sumPct); sumPts = round2(sumPts);
  if (container) container.innerHTML = items.map(d =>
    `<div class="pts-row-item"><span class="name">${d.name}</span><span class="pts-val">${_fmtPts(d.pts)} б.</span></div>`).join('');
  if (sumEl) {
    const ok = sumPct === 100;
    sumEl.className = 'sw-contrib-sum ' + (ok ? 'ok' : 'bad');
    sumEl.innerHTML = ok ? `${ic('check')} сумма долей 100%` : `сумма долей ${sumPct}% — должно быть 100%`;
  }
  const totEl = document.getElementById('sw-pts-sum');
  if (totEl) { totEl.textContent = `${_fmtPts(sumPts)} / 5`; totEl.className = (sumPct === 100) ? 'pts-ok' : 'pts-over'; }
  return { sumPct, sumPts };
}

function getAuthorsFromForm() {
  const rows = document.querySelectorAll('#sw-authors-body tr');
  return Array.from(rows).map(r => {
    const pct = parseInt(r.cells[2].querySelector('input').value) || 0;
    return {
      full_name: r.cells[0].querySelector('input').value.trim(),
      position: r.cells[1].querySelector('input').value.trim(),
      contribution_percent: pct,
      points_claimed: round2(pct / 100 * 5),
    };
  });
}

// Баллы, идущие в ЛИЧНЫЙ отчёт = только баллы авторов, чья фамилия совпадает с профилем.
// Никаких «первых авторов»: чужой вклад не приписывается пользователю.
function myPointsFrom(authors, ptsKey) {
  const ln = (state.profile.last_name || '').toLowerCase().trim();
  if (!ln) return 0;
  // Совпадение по слову-токену, а не по подстроке: «Иванов» не ловит «Иванова»,
  // «Ким» не ловит «Якимов». ФИО вида «Григоренко А.Г.» → токен «григоренко».
  return (authors || [])
    .filter(a => (a.full_name || '').toLowerCase().split(/[\s.,]+/).filter(Boolean).includes(ln))
    .reduce((s, a) => s + (parseFloat(a[ptsKey]) || 0), 0);
}

function noMyPointsMsg() {
  const ln = state.profile.last_name;
  return ln
    ? `Вас (${ln}) нет среди авторов с баллами. В личный отчёт идут только ваши баллы.`
    : 'Укажите свою фамилию в разделе «Профиль» — без неё система не знает, какие баллы ваши.';
}

// Сбор и валидация данных формы ПО. Возвращает объект данных или null (с alert).
// Один источник истины для inline-добавления в отчёт И для регистрации в картотеку.
function collectSoftwareData() {
  const title = document.getElementById('sw-title').value.trim();
  const certInput = document.getElementById('sw-cert');
  const cert = normalizeSoftwareCertificate(certInput.value);
  certInput.value = cert;
  const date = document.getElementById('sw-date').value;
  const output = document.getElementById('sw-output').value.trim();
  if (!title || !cert) { alert('Введите название и номер свидетельства'); return null; }
  const { sumPct } = recalcSwPts();
  if (sumPct !== 100) { alert(`Сумма долей авторов должна быть ровно 100% (сейчас ${sumPct}%).`); return null; }
  const authors = getAuthorsFromForm();
  const myPts = round2(myPointsFrom(authors, 'points_claimed'));
  if (myPts <= 0) { alert(noMyPointsMsg()); return null; }
  const fileInput = document.getElementById('sw-file-input');
  if (fileInput?._alreadyUsed) {
    alert('Это свидетельство уже было подано в одном из отчётов');
    return null;
  }
  return {
    title, certificate_number: cert, registration_date: date, output_data: output,
    authors, points_claimed: myPts, docx_filename: fileInput?._docxFilename || null,
    id: fileInput?._softwareId || null,
  };
}

function addSoftwareToReport() {
  const data = collectSoftwareData();
  if (!data) return;
  const title = data.title, cert = data.certificate_number, myPts = data.points_claimed;

  if (state.editingItemKey) {
    const item = state.addedItems.find(i => i.key === state.editingItemKey);
    if (item) {
      item.label = title;
      item.sub = `№${cert} · ПО (п.20)`;
      item.pts = myPts;
      item.data = { ...item.data, ...data };
      item._dirty = true;   // правки нужно пересохранить в БД при подаче
    }
    state.editingItemKey = null;
    updateScore();
    closePanel();
    return;
  }

  const certKey = softwareCertificateKey(cert);
  if (state.addedItems.find(i => i.type === 'software' && softwareCertificateKey(i.data.certificate_number) === certKey)) {
    alert('Это свидетельство уже добавлено в отчёт'); return;
  }
  addItem('software', ic('software'), title, `№${cert} · ПО (п.20)`, myPts, data);

  if (_storeSelectedSoftwareInBatch(data, 'report')) {
    toast('Программа добавлена в отчёт. Выберите следующую.');
    return;
  }

  // Reset form
  _resetSoftwareForm(true);
  addAuthorRow();
}

function _swParseBadge(d) {
  if (d._batchReady) return `<span class="sw-parse-badge ready">${ic('check')} вклад распределён</span>`;
  if (d._addedToReport) return `<span class="sw-parse-badge ready">${ic('check')} добавлено в отчёт</span>`;
  if (d.already_used) return `<span class="sw-parse-badge used">${ic('warning')} уже подано — в архиве «Поданы»</span>`;
  if (d.in_bank) return `<span class="sw-parse-badge bank">уже в картотеке</span>`;
  return '';
}

function _resetSoftwareForm(clearUpload) {
  ['sw-title', 'sw-cert', 'sw-date', 'sw-output'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const authors = document.getElementById('sw-authors-body');
  if (authors) authors.innerHTML = '';
  const points = document.getElementById('sw-pts-rows');
  if (points) points.innerHTML = '';
  const block = document.getElementById('sw-pts-block');
  if (block) block.style.display = 'none';
  const sum = document.getElementById('sw-contrib-sum');
  if (sum) sum.textContent = '';
  const fileInput = document.getElementById('sw-file-input');
  if (fileInput) {
    if (clearUpload) fileInput.value = '';
    fileInput._docxFilename = null;
    fileInput._softwareId = null;
    fileInput._alreadyUsed = false;
  }
}

function _renderSoftwareBatchList() {
  const pr = document.getElementById('sw-parse-result');
  const list = pr?._swList || [];
  if (!pr || !list.length) return;
  const registerMode = _isSoftwareRegisterMode();
  const errors = pr._swErrors || [];
  const errorHtml = errors.length
    ? `<div class="err-box" style="margin:8px 0">${errors.map(error =>
        `${_swEsc(error.filename)}: ${_swEsc(error.detail)}`).join('<br>')}</div>`
    : '';

  let actionHtml = '';
  if (registerMode) {
    const pending = list.filter(entry => !entry.already_used && !entry.in_bank);
    const ready = pending.filter(entry => entry._batchReady && entry._preparedData);
    actionHtml = pending.length
      ? `<button class="btn btn-primary btn-sm" style="margin:8px 0 4px" onclick="registerPreparedSoftwareBatch(this)" ${ready.length === pending.length ? '' : 'disabled'}>Зарегистрировать все новые в РИД</button>
         <div style="font-size:11px;color:var(--text-4);margin-bottom:8px">Распределён вклад: ${ready.length} из ${pending.length}</div>`
      : `<button class="btn btn-primary btn-sm" style="margin:8px 0 10px" onclick="closeRegisterModal()">Завершить</button>`;
  } else {
    const selectable = list.filter(entry => !entry.already_used);
    const added = selectable.filter(entry => entry._addedToReport);
    actionHtml = `<button class="btn btn-primary btn-sm" style="margin:8px 0 4px" onclick="finishSoftwareBatchSelection()">Завершить выбор</button>
      <div style="font-size:11px;color:var(--text-4);margin-bottom:8px">Добавлено в отчёт: ${added.length} из ${selectable.length}</div>`;
  }

  pr.innerHTML = `<div class="prt">${ic('check')} Распознано ${list.length} ${_plural(list.length, 'программа', 'программы', 'программ')}</div>
    ${errorHtml}${actionHtml}` + list.map((entry, index) => {
      const unavailable = entry.already_used || (registerMode && entry.in_bank) || entry._addedToReport;
      const buttonLabel = entry._batchReady ? 'Изменить' : (entry._addedToReport ? 'Добавлено' : (registerMode && entry.in_bank ? 'В картотеке' : 'Выбрать'));
      return `<div class="sw-parse-row${entry.already_used ? ' used' : ''}">
        <div class="sw-parse-info">
          <div class="sw-parse-title">${_swEsc(entry.title)}</div>
          <div class="sw-parse-meta">${_swEsc(entry.certificate_number)} · ${_swEsc(entry.registration_date)}${entry.source_filename ? ` · ${_swEsc(entry.source_filename)}` : ''}</div>
          ${_swParseBadge(entry)}
        </div>
        <button class="btn btn-secondary btn-sm" onclick="swSelectEntry(${index})" ${unavailable ? 'disabled' : ''}>${buttonLabel}${unavailable ? '' : ` ${ic('arrowRight')}`}</button>
      </div>`;
    }).join('');
}

async function parseSoftwareFile(input) {
  if (!input.files[0]) return;
  const fd = new FormData();
  Array.from(input.files).forEach(file => fd.append('files', file));
  try {
    const response = await fetch('/api/software/parse-batch', { method: 'POST', body: fd });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || 'Не удалось обработать документ');
    const list = payload.entries || [];
    const errors = payload.errors || [];
    if (!Array.isArray(list) || !list.length) throw new Error('Не найдено ни одной программы');

    const pr = document.getElementById('sw-parse-result');
    if (!pr) return;
    pr.style.display = '';
    pr.className = 'parse-result';
    pr._swList = list;
    pr._swErrors = errors;
    pr._swSelectedIndex = null;

    if (list.length === 1) {
      // Single entry — fill form as before
      const d = list[0];
      pr.innerHTML = `<div class="prt">${ic('check')} Распознано из файла</div>
        ${_swParseBadge(d)}
        <div class="parse-field"><span class="parse-key">Название:</span><span>${_swEsc(d.title)}</span></div>
        <div class="parse-field"><span class="parse-key">№ свидетельства:</span><span>${_swEsc(d.certificate_number)}</span></div>
        <div class="parse-field"><span class="parse-key">Дата:</span><span>${_swEsc(d.registration_date)}</span></div>
        ${errors.length ? `<div class="err-box" style="margin-top:8px">Не обработано файлов: ${errors.length}</div>` : ''}`;
      _fillSwForm(d);
      swMode('manual');
      if (errors.length) {
        alert(`Часть файлов не обработана:\n${errors.map(error => `${error.filename}: ${error.detail}`).join('\n')}`);
      }
    } else {
      _renderSoftwareBatchList();
      if (errors.length) {
        alert(`Часть файлов не обработана:\n${errors.map(error => `${error.filename}: ${error.detail}`).join('\n')}`);
      }
    }
  } catch(e) { alert('Ошибка парсинга: ' + e.message); }
}

async function registerPreparedSoftwareBatch(button) {
  const pr = document.getElementById('sw-parse-result');
  const list = pr?._swList || [];
  const pending = list.filter(entry => !entry.already_used && !entry.in_bank);
  const missing = pending.filter(entry => !entry._batchReady || !entry._preparedData);
  if (missing.length) {
    alert(`Сначала распределите вклад для всех новых программ. Осталось: ${missing.length}.`);
    return;
  }
  if (!pending.length) {
    closeRegisterModal();
    return;
  }
  if (button) button.disabled = true;
  try {
    const result = await api('POST', '/software/register-batch', {
      entries: pending.map(entry => entry._preparedData),
    });
    closeRegisterModal();
    toast(`Зарегистрировано программ: ${result.registered_count || 0}`, 4000);
    await loadDeposits();
  } catch (error) {
    if (button) button.disabled = false;
    const msg = document.getElementById('register-modal-msg');
    if (msg) { msg.className = 'err-box'; msg.textContent = error.message; }
  }
}

function finishSoftwareBatchSelection() {
  closePanel();
}

function _storeSelectedSoftwareInBatch(data, mode) {
  const pr = document.getElementById('sw-parse-result');
  const index = pr?._swSelectedIndex;
  if (!pr || !Number.isInteger(index) || !pr._swList?.[index]) return false;
  const entry = pr._swList[index];
  entry.authors = data.authors.map(author => ({ ...author }));
  entry.points_claimed = data.points_claimed;
  if (mode === 'register') {
    entry._preparedData = {
      ...data,
      id: null,
      docx_filename: null,
      authors: data.authors.map(author => ({ ...author })),
    };
    entry._batchReady = true;
  } else {
    entry._addedToReport = true;
  }
  pr._swSelectedIndex = null;
  _resetSoftwareForm(false);
  swMode('upload');
  _renderSoftwareBatchList();
  return true;
}

function stageSelectedSoftwareRegistration(data) {
  return _storeSelectedSoftwareInBatch(data, 'register');
}

function swSelectEntry(idx) {
  const pr = document.getElementById('sw-parse-result');
  const d = pr._swList && pr._swList[idx];
  if (!d || d.already_used || (_isSoftwareRegisterMode() && d.in_bank)) return;
  pr._swSelectedIndex = idx;
  _fillSwForm(d._preparedData || d);
  swMode('manual');
}

function _fillSwForm(d) {
  document.getElementById('sw-title').value = d.title || '';
  document.getElementById('sw-cert').value = d.certificate_number || '';
  document.getElementById('sw-date').value = d.registration_date ? isoDate(d.registration_date) : '';
  document.getElementById('sw-output').value = d.output_data || '';
  const fileInput = document.getElementById('sw-file-input');
  if (fileInput) {
    fileInput._docxFilename = d.docx_filename || null;
    fileInput._softwareId = d.id || d.existing_id || null;
    fileInput._alreadyUsed = !!d.already_used;
  }
  const tbody = document.getElementById('sw-authors-body');
  if (tbody) { tbody.innerHTML = ''; (d.authors || []).forEach(a => addAuthorRow(a.full_name, a.position, a.contribution_percent)); }
  recalcSwPts();   // баллы считаются из вклада автоматически
}

function isoDate(ddmmyyyy) {
  const value = String(ddmmyyyy || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// ─── ARTICLE PANEL ─────────────────────────────────────────────────────────
let _artDocxFilename = null;

function buildArticlePanel(type, embed) {
  const labels = { article_vak_rinc: 'ВАК + РИНЦ · п.27.1 · 8 б.', article_rinc: 'РИНЦ · п.27.2 · 5 б.', article_closed: 'Закрытое издание · п.27.3 · 5 б.' };
  const maxPts = WEIGHTS[type] || 5;
  return `${embed ? '' : `<div class="panel-title">Статья: ${labels[type]} <button class="btn btn-secondary btn-sm" onclick="closePanel()">${ic('close')} закрыть</button></div>`}
    <div class="mode-toggle">
      <button id="art-btn-upload" class="mode-btn active" onclick="artMode('upload')">${ic('folder')} Загрузить файл</button>
      <button id="art-btn-manual" class="mode-btn" onclick="artMode('manual')">${ic('edit')} Ввести вручную</button>
    </div>

    <div id="art-upload-zone">
      <label style="cursor:pointer;display:block;border:1.5px dashed var(--border2);border-radius:8px;padding:24px;text-align:center;color:var(--text-4);font-size:13px">
        <input type="file" id="art-file-input" accept=".docx" style="display:none" onchange="parseArticleFile(this)">
        ${ic('file')} Перетащите докладную записку (.docx) или нажмите для выбора
      </label>
      <div id="art-parse-result" style="margin-top:10px"></div>
    </div>

    <div id="art-manual-form" style="display:none">
      <div class="form-grid">
        <div class="field full"><label>Название статьи</label>
          <input type="text" id="art-title" placeholder="Название статьи"></div>
        <div class="field full"><label>Журнал / сборник / выходные данные</label>
          <input type="text" id="art-pub" placeholder="Название издания, год, номер, стр."></div>
      </div>
      <div style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;font-weight:600;color:var(--text-2)">Авторы и баллы</span>
          <span id="art-pts-total" style="font-size:12px;color:var(--text-4)">0 / ${maxPts} б.</span>
        </div>
        <table class="data-table" style="margin-bottom:6px">
          <thead><tr><th>ФИО</th><th style="width:90px;text-align:center">Баллов</th><th style="width:28px"></th></tr></thead>
          <tbody id="art-authors-body"></tbody>
        </table>
        <button class="add-btn" onclick="addArtAuthorRow()">+ Автора</button>
      </div>
      ${embed ? '' : `<div style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="addArticleToReport('${type}')">+ Добавить в отчёт</button>
      </div>`}
    </div>`;
}

function artMode(mode) {
  document.getElementById('art-upload-zone').style.display = mode === 'upload' ? '' : 'none';
  document.getElementById('art-manual-form').style.display  = mode === 'manual' ? '' : 'none';
  document.getElementById('art-btn-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('art-btn-manual').classList.toggle('active', mode === 'manual');
}

async function parseArticleFile(input) {
  if (!input.files[0]) return;
  const fd = new FormData();
  fd.append('file', input.files[0]);
  const pr = document.getElementById('art-parse-result');
  pr.innerHTML = '<span style="color:var(--text-4);font-size:12px">Обработка...</span>';
  try {
    const resp = await fetch('/api/articles/parse', { method: 'POST', body: fd });
    if (!resp.ok) { const e = await resp.json().catch(()=>({detail:'Ошибка'})); pr.innerHTML = `<div class="err-box">${e.detail}</div>`; return; }
    const entries = await resp.json();
    _artDocxFilename = entries[0]?.docx_filename || null;
    if (entries.length === 1) {
      _fillArtForm(entries[0]); artMode('manual');
    } else {
      window._artParsedEntries = entries;
      pr.innerHTML = `<div style="font-size:12px;color:var(--text-3);margin-bottom:6px">Найдено статей: <b>${entries.length}</b>. Выберите нужную:</div>` +
        entries.map((e, i) => `<div onclick="artSelectEntry(${i})" style="padding:7px 10px;margin-bottom:4px;background:var(--bg);border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <div style="font-size:12px;font-weight:600">${e.title.substring(0,70)}${e.title.length>70?'…':''}</div>
          <div style="font-size:11px;color:var(--text-4);margin-top:2px">${e.publication.substring(0,70)}</div>
        </div>`).join('');
    }
  } catch(err) { pr.innerHTML = `<div class="err-box">Ошибка: ${err.message}</div>`; }
}

function artSelectEntry(idx) {
  const entries = window._artParsedEntries || [];
  if (entries[idx]) { _fillArtForm(entries[idx]); artMode('manual'); }
}

function _fillArtForm(d) {
  document.getElementById('art-title').value = d.title || '';
  document.getElementById('art-pub').value = d.publication || '';
  const tbody = document.getElementById('art-authors-body');
  if (tbody) {
    tbody.innerHTML = '';
    const maxPts = _artMaxPts();
    const authors = d.authors || [];
    const totalPct = sumPct(authors);
    authors.forEach(a => {
      addArtAuthorRow(a.full_name, pctToPts(a.contribution_percent, totalPct, maxPts));
    });
    if (!authors.length) {
      const p = state.profile;
      const ini = (p.first_patronymic||'').split(' ').filter(Boolean).map(w=>w[0]+'.').join('');
      addArtAuthorRow(p.last_name ? p.last_name+(ini?' '+ini:'') : '', maxPts);
    }
  }
}

function _artMaxPts() {
  return WEIGHTS[state.currentPanel] || 5;
}

function addArtAuthorRow(name = '', pts = 0) {
  const tbody = document.getElementById('art-authors-body');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" value="${name}" placeholder="Иванов И.И." style="width:100%" oninput="updateArtPtsTotal()"></td>
    <td style="text-align:center"><input type="number" value="${pts}" min="0" max="${_artMaxPts()}" step="0.1" style="width:70px;text-align:center" oninput="updateArtPtsTotal()"></td>
    <td><button onclick="this.closest('tr').remove();updateArtPtsTotal()" style="background:none;border:none;cursor:pointer;color:var(--text-5);font-size:14px">${ic('close')}</button></td>`;
  tbody.appendChild(tr);
  updateArtPtsTotal();
}

function updateArtPtsTotal() {
  const rows = document.querySelectorAll('#art-authors-body tr');
  let sum = 0;
  rows.forEach(r => { sum += parseFloat(r.querySelectorAll('input')[1].value) || 0; });
  const max = _artMaxPts();
  const el = document.getElementById('art-pts-total');
  if (el) {
    el.textContent = sum.toFixed(1) + ' / ' + max + ' б.';
    el.style.color = sum > max ? 'var(--danger)' : (sum === max ? '#6FC99A' : 'var(--text-4)');
  }
}

// Сбор и валидация данных формы статьи. Возвращает {data, sub, myPts} или null.
// Один источник истины для inline-добавления и регистрации в картотеку.
function collectArticleData(type) {
  const title = document.getElementById('art-title').value.trim();
  const pub = document.getElementById('art-pub').value.trim();
  if (!title) { alert('Введите название статьи'); return null; }

  const authorList = [];
  document.querySelectorAll('#art-authors-body tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const name = inputs[0].value.trim();
    const pts = parseFloat(inputs[1].value) || 0;
    if (name) authorList.push({ full_name: name, points: pts });
  });
  if (!authorList.length) { alert('Добавьте хотя бы одного автора'); return null; }

  const maxPts = WEIGHTS[type] || 5;
  let myPts = myPointsFrom(authorList, 'points');
  myPts = Math.min(Math.max(myPts, 0), maxPts);
  if (myPts <= 0) { alert(noMyPointsMsg()); return null; }

  const typeKey = type.replace('article_', '');
  const sub = ART_LABELS[typeKey] + (pub ? ' · ' + pub : '');
  return {
    data: { title, publication: pub, article_type: typeKey, points_taken: myPts,
            author_list: authorList, docx_filename: _artDocxFilename || null },
    sub, myPts, title,
  };
}

function addArticleToReport(type) {
  const collected = collectArticleData(type);
  if (!collected) return;
  const { data, sub, myPts, title } = collected;

  if (state.editingItemKey) {
    const item = state.addedItems.find(i => i.key === state.editingItemKey);
    if (item) {
      item.label = title; item.sub = sub; item.pts = myPts;
      item.data = { ...item.data, ...data };   // сохраняем id для upsert
      item._dirty = true;
    }
    state.editingItemKey = null;
    updateScore(); closePanel();
    return;
  }

  addItem('article', ic('article'), title, sub, myPts, data);
  _artDocxFilename = null;
  // Reset manual form
  document.getElementById('art-title').value = '';
  document.getElementById('art-pub').value = '';
  document.getElementById('art-authors-body').innerHTML = '';
  document.getElementById('art-parse-result').innerHTML = '';
  const fi = document.getElementById('art-file-input');
  if (fi) fi.value = '';
  artMode('upload');
  const p = state.profile;
  const initials = (p.first_patronymic || '').split(' ').filter(Boolean).map(w => w[0] + '.').join('');
  addArtAuthorRow(p.last_name ? p.last_name + (initials ? ' ' + initials : '') : '', WEIGHTS[type] || 5);
}

// ─── CONFERENCE PANEL (п.24) ─────────────────────────────────────────────────
// Доклад на конференции: документ не парсится — просто прикладывается как подтверждение.
let _confCertFilename = null;

function buildConferencePanel() {
  return `<div class="panel-title">Доклад на конференции (п.24 · 5 б.)
    <button class="btn btn-secondary btn-sm" onclick="closePanel()">${ic('close')} закрыть</button></div>
    <div class="form-grid" style="margin-bottom:12px">
      <div class="field full"><label>Конференция / тема доклада</label>
        <input type="text" id="conf-title" placeholder="Напр.: II Всероссийская НПК «…» — доклад «…»"></div>
    </div>
    <div class="field full" style="margin-bottom:12px">
      <label>Сертификат участия (изображение или PDF)</label>
      <label class="upload-label" id="conf-cert-label" style="display:inline-flex;margin-top:4px">
        <span>${ic('paperclip')} Выбрать файл</span>
        <input type="file" accept="image/*,.pdf" style="display:none" onchange="uploadConferenceCert(this)">
      </label>
      <div style="font-size:11px;color:var(--text-5);margin-top:6px">Документ не распознаётся — прикладывается к отчёту и попадает в архив как подтверждение.</div>
    </div>
    <button class="btn btn-primary" onclick="addConferenceToReport()">${ic('check')} Добавить в отчёт</button>`;
}

async function uploadConferenceCert(input) {
  if (!input.files[0]) return;
  const fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    const r = await fetch('/api/upload/conference', { method: 'POST', body: fd });
    const d = await r.json();
    _confCertFilename = d.filename;
    const lbl = document.getElementById('conf-cert-label');
    if (lbl) { lbl.className = 'upload-label has-file'; lbl.querySelector('span').innerHTML = ic('paperclip') + ' ' + input.files[0].name; }
  } catch(e) { alert('Ошибка загрузки: ' + e.message); }
}

function addConferenceToReport() {
  if (!_confCertFilename) { alert('Приложите сертификат участия (изображение или PDF)'); return; }
  const title = document.getElementById('conf-title').value.trim();
  const label = title || 'Доклад на конференции';
  const pts = WEIGHTS.conference || 5;
  const data = { title: label, certificate_filename: _confCertFilename, points_taken: pts };

  if (state.editingItemKey) {
    const item = state.addedItems.find(i => i.key === state.editingItemKey);
    if (item) { item.label = label; item.sub = 'п.24 · Доклад на конференции'; item.pts = pts; item.data = data; }
    state.editingItemKey = null;
    updateScore(); closePanel();
    return;
  }

  addItem('conference', ic('conference'), label, 'п.24 · Доклад на конференции', pts, data);
  _confCertFilename = null;
  closePanel();
}

