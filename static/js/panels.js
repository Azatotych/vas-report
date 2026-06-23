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
    return `<div class="panel-title">${levelLabel} <button class="btn btn-secondary btn-sm" onclick="closePanel()">✕</button></div>
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
    const uploadTxt = cfn ? '📎 ' + cfn.split('_').slice(2).join('_') : '📎 Подтверждайка';
    const showCZ = alreadyAdded ? '' : 'display:none';
    return `<div class="order-row">
      <input type="checkbox" class="order-check" id="oc-${o.id}" ${checked} onchange="toggleOrderItem(${o.id}, this.checked)">
      <div class="order-info">
        <div class="order-name">№${o.number} — ${o.title}</div>
        <div class="order-meta">${o.order_date ? 'от ' + o.order_date : ''}</div>
        <div class="order-badges">${lvlBadge}${dlBadge}</div>
        <div class="confirm-zone" style="${showCZ}" id="confirm-zone-${o.id}">
          <label class="${uploadCls}" id="confirm-label-${o.id}">
            ${uploadTxt}
            <input type="file" accept=".docx,.pdf" style="display:none" onchange="uploadConfirmation(${o.id}, this)">
          </label>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="panel-title">${levelLabel} <button class="btn btn-secondary btn-sm" onclick="closePanel()">✕ закрыть</button></div>
    <div style="font-size:12px;color:#888;margin-bottom:10px">Отметьте задания, по которым отчитываетесь в этом месяце</div>
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
    addItem('order', '📋', `№${order.number} — ${order.title}`, order.level === 'academy' ? 'Задание ВАС · п.30.2' : 'Задание вышестоящего · п.30.1', pts, order);
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
    if (lbl) { lbl.className = 'upload-label has-file'; lbl.childNodes[0].textContent = '📎 ' + input.files[0].name; }
  } catch(e) { alert('Ошибка загрузки: ' + e.message); }
}

// ─── SOFTWARE PANEL ────────────────────────────────────────────────────────
function buildSoftwarePanel() {
  return `<div class="panel-title">ПО / Свидетельство ФИПС <button class="btn btn-secondary btn-sm" onclick="closePanel()">✕ закрыть</button></div>
    <div class="mode-toggle">
      <button class="mode-btn" id="sw-btn-upload" onclick="swMode('upload')">⬆ Загрузить .docx</button>
      <button class="mode-btn active" id="sw-btn-manual" onclick="swMode('manual')">✏ Ввести вручную</button>
    </div>
    <div id="sw-upload-zone" style="display:none">
      <div class="upload-zone" onclick="document.getElementById('sw-file-input').click()">
        <div style="font-size:24px;margin-bottom:5px">📄</div>
        Выберите «Докладная записка ПО.docx»
      </div>
      <input type="file" id="sw-file-input" accept=".docx" style="display:none" onchange="parseSoftwareFile(this)">
      <div id="sw-parse-result" style="display:none"></div>
    </div>
    <div id="sw-manual-form">
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
      <button class="add-btn" onclick="addAuthorRow()">+ Автора</button>
      <div class="pts-block" id="sw-pts-block" style="display:none;margin-top:12px">
        <div style="font-size:12px;font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between">
          <span>Баллы в этом месяце</span>
          <span style="color:#888;font-weight:400">Всего на свидетельство: <b>5</b></span>
        </div>
        <div id="sw-pts-rows"></div>
        <div class="pts-total">
          <span style="color:#555">Итого заявлено:</span>
          <span id="sw-pts-sum" class="pts-ok">0 / 5</span>
        </div>
        <div id="sw-pts-warn" style="display:none;margin-top:6px"></div>
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="addSoftwareToReport()">+ Добавить в отчёт</button>
      </div>
    </div>`;
}

function swMode(mode) {
  document.getElementById('sw-upload-zone').style.display = mode === 'upload' ? '' : 'none';
  document.getElementById('sw-manual-form').style.display = mode === 'manual' ? '' : 'none';
  document.getElementById('sw-btn-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('sw-btn-manual').classList.toggle('active', mode === 'manual');
}

function addAuthorRow(fio='', pos='', pct=100) {
  const tbody = document.getElementById('sw-authors-body');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" value="${fio}" placeholder="Иванов И.И."></td>
    <td><input type="text" value="${pos}" placeholder="МНС НИО-5"></td>
    <td><input type="number" value="${pct}" min="0" max="100" onchange="syncPtsRows()" style="text-align:center"></td>
    <td><button onclick="this.closest('tr').remove();syncPtsRows()" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:14px">✕</button></td>`;
  tbody.appendChild(tr);
  syncPtsRows();
}

function syncPtsRows() {
  const rows = document.querySelectorAll('#sw-authors-body tr');
  const block = document.getElementById('sw-pts-block');
  const container = document.getElementById('sw-pts-rows');
  if (!rows.length || !block) return;
  block.style.display = rows.length ? '' : 'none';
  const prev = {};
  if (container) container.querySelectorAll('.pts-row-item').forEach(r => { prev[r.dataset.name] = r.querySelector('input').value; });
  if (container) container.innerHTML = '';
  rows.forEach(row => {
    const name = row.cells[0].querySelector('input').value.trim() || 'Автор';
    const val = prev[name] !== undefined ? prev[name] : '0';
    const div = document.createElement('div');
    div.className = 'pts-row-item';
    div.dataset.name = name;
    div.innerHTML = `<span class="name">${name}</span><input type="number" value="${val}" min="0" max="5" step="0.5" onchange="recalcPts()"><span style="font-size:11px;color:#888">б.</span>`;
    container.appendChild(div);
  });
  recalcPts();
}

function recalcPts() {
  const inputs = document.querySelectorAll('#sw-pts-rows input');
  let sum = 0;
  inputs.forEach(i => sum += parseFloat(i.value) || 0);
  const el = document.getElementById('sw-pts-sum');
  const warnEl = document.getElementById('sw-pts-warn');
  if (!el) return sum;
  el.textContent = sum + ' / 5';
  if (sum > 5) {
    el.className = 'pts-over';
    warnEl.style.display = '';
    warnEl.className = 'err-box';
    warnEl.textContent = '⚠ Сумма превышает 5 баллов';
  } else if (sum < 5) {
    el.className = 'pts-warn';
    warnEl.style.display = '';
    warnEl.className = 'warn-box';
    warnEl.innerHTML = '⚠ ' + (5 - sum).toFixed(1) + ' балл(а) не заявлено — они сгорят.';
  } else {
    el.className = 'pts-ok';
    if (warnEl) warnEl.style.display = 'none';
  }
  return sum;
}

function getAuthorsFromForm() {
  const rows = document.querySelectorAll('#sw-authors-body tr');
  const ptsRows = document.querySelectorAll('#sw-pts-rows .pts-row-item');
  const ptsMap = {};
  ptsRows.forEach(r => { ptsMap[r.dataset.name] = parseFloat(r.querySelector('input').value) || 0; });
  return Array.from(rows).map(r => {
    const name = r.cells[0].querySelector('input').value.trim();
    return {
      full_name: name,
      position: r.cells[1].querySelector('input').value.trim(),
      contribution_percent: parseInt(r.cells[2].querySelector('input').value) || 0,
      points_claimed: ptsMap[name] || 0,
    };
  });
}

// Баллы, идущие в ЛИЧНЫЙ отчёт = только баллы авторов, чья фамилия совпадает с профилем.
// Никаких «первых авторов»: чужой вклад не приписывается пользователю.
function myPointsFrom(authors, ptsKey) {
  const ln = (state.profile.last_name || '').toLowerCase().trim();
  if (!ln) return 0;
  return (authors || [])
    .filter(a => (a.full_name || '').toLowerCase().includes(ln))
    .reduce((s, a) => s + (parseFloat(a[ptsKey]) || 0), 0);
}

function noMyPointsMsg() {
  const ln = state.profile.last_name;
  return ln
    ? `Вас (${ln}) нет среди авторов с баллами. В личный отчёт идут только ваши баллы.`
    : 'Укажите свою фамилию в разделе «Профиль» — без неё система не знает, какие баллы ваши.';
}

function addSoftwareToReport() {
  const title = document.getElementById('sw-title').value.trim();
  const cert = document.getElementById('sw-cert').value.trim();
  const date = document.getElementById('sw-date').value;
  const output = document.getElementById('sw-output').value.trim();
  if (!title || !cert) { alert('Введите название и номер свидетельства'); return; }
  const sum = recalcPts();
  if (sum === 0) { alert('Укажите баллы хотя бы для одного автора'); return; }
  if (sum > 5) { alert('Сумма баллов превышает 5'); return; }
  const authors = getAuthorsFromForm();
  const myPts = myPointsFrom(authors, 'points_claimed');
  if (myPts <= 0) { alert(noMyPointsMsg()); return; }
  const data = { title, certificate_number: cert, registration_date: date, output_data: output, authors, points_claimed: myPts };

  if (state.editingItemKey) {
    const item = state.addedItems.find(i => i.key === state.editingItemKey);
    if (item) {
      item.label = title;
      item.sub = `№${cert} · п.20`;
      item.pts = myPts;
      item.data = { ...item.data, ...data };
    }
    state.editingItemKey = null;
    updateScore();
    closePanel();
    return;
  }

  if (state.addedItems.find(i => i.type === 'software' && i.data.certificate_number === cert)) {
    alert('Это свидетельство уже добавлено в отчёт'); return;
  }
  addItem('software', '💾', title, `№${cert} · п.20`, myPts, data);

  // Reset form
  document.getElementById('sw-title').value = '';
  document.getElementById('sw-cert').value = '';
  document.getElementById('sw-date').value = '';
  document.getElementById('sw-output').value = '';
  document.getElementById('sw-authors-body').innerHTML = '';
  if (document.getElementById('sw-pts-rows')) document.getElementById('sw-pts-rows').innerHTML = '';
  if (document.getElementById('sw-pts-block')) document.getElementById('sw-pts-block').style.display = 'none';
  addAuthorRow();
}

async function parseSoftwareFile(input) {
  if (!input.files[0]) return;
  const fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    const list = await (await fetch('/api/software/parse', { method: 'POST', body: fd })).json();
    if (!Array.isArray(list) || !list.length) { alert('Не найдено ни одной программы'); return; }

    const pr = document.getElementById('sw-parse-result');
    if (!pr) return;
    pr.style.display = '';
    pr.className = 'parse-result';

    if (list.length === 1) {
      // Single entry — fill form as before
      const d = list[0];
      pr.innerHTML = `<div class="prt">✓ Распознано из файла</div>
        <div class="parse-field"><span class="parse-key">Название:</span><span>${d.title}</span></div>
        <div class="parse-field"><span class="parse-key">№ свидетельства:</span><span>${d.certificate_number}</span></div>
        <div class="parse-field"><span class="parse-key">Дата:</span><span>${d.registration_date}</span></div>`;
      _fillSwForm(d);
      swMode('manual');
    } else {
      // Multiple entries — show list, each with "Заполнить форму" button
      pr.innerHTML = `<div class="prt">✓ Распознано ${list.length} программы из файла</div>` +
        list.map((d, i) => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #d1fae5">
            <div>
              <div style="font-size:12px;font-weight:600">${d.title}</div>
              <div style="font-size:11px;color:#6b7280">${d.certificate_number} · ${d.registration_date}</div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="swSelectEntry(${i})" data-idx="${i}">Выбрать →</button>
          </div>`).join('');
      // Store list for selection
      pr._swList = list;
    }
  } catch(e) { alert('Ошибка парсинга: ' + e.message); }
}

function swSelectEntry(idx) {
  const pr = document.getElementById('sw-parse-result');
  const d = pr._swList && pr._swList[idx];
  if (!d) return;
  _fillSwForm(d);
  swMode('manual');
  pr.innerHTML = `<div class="prt">✓ Выбрана программа ${idx + 1}</div>
    <div class="parse-field"><span class="parse-key">Название:</span><span>${d.title}</span></div>
    <div class="parse-field"><span class="parse-key">№ свидетельства:</span><span>${d.certificate_number}</span></div>
    <div class="parse-field"><span class="parse-key">Дата:</span><span>${d.registration_date}</span></div>
    <button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="document.getElementById('sw-file-input').click()">← Другой файл</button>`;
}

function _fillSwForm(d) {
  document.getElementById('sw-title').value = d.title || '';
  document.getElementById('sw-cert').value = d.certificate_number || '';
  document.getElementById('sw-date').value = d.registration_date ? isoDate(d.registration_date) : '';
  document.getElementById('sw-output').value = d.output_data || '';
  if (d.docx_filename) document.getElementById('sw-file-input')._docxFilename = d.docx_filename;
  const tbody = document.getElementById('sw-authors-body');
  if (tbody) { tbody.innerHTML = ''; (d.authors || []).forEach(a => addAuthorRow(a.full_name, a.position, a.contribution_percent)); }
  // Auto-apply pts from contribution_percent
  const authors = d.authors || [];
  const totalPct = sumPct(authors);
  if (totalPct > 0) {
    const ptsMap = {};
    authors.forEach(a => { ptsMap[a.full_name] = pctToPts(a.contribution_percent, totalPct, 5); });
    setTimeout(() => {
      document.querySelectorAll('#sw-pts-rows .pts-row-item').forEach(r => {
        const inp = r.querySelector('input');
        if (inp && ptsMap[r.dataset.name] !== undefined) inp.value = ptsMap[r.dataset.name];
      });
      recalcPts();
    }, 50);
  }
}

function isoDate(ddmmyyyy) {
  const m = ddmmyyyy.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// ─── ARTICLE PANEL ─────────────────────────────────────────────────────────
let _artDocxFilename = null;

function buildArticlePanel(type) {
  const labels = { article_vak_rinc: 'ВАК + РИНЦ · п.27.1 · 8 б.', article_rinc: 'РИНЦ · п.27.2 · 5 б.', article_closed: 'Закрытое издание · п.27.3 · 5 б.' };
  const maxPts = WEIGHTS[type] || 5;
  return `<div class="panel-title">Статья: ${labels[type]} <button class="btn btn-secondary btn-sm" onclick="closePanel()">✕ закрыть</button></div>
    <div class="mode-toggle">
      <button id="art-btn-upload" class="mode-btn active" onclick="artMode('upload')">📂 Загрузить файл</button>
      <button id="art-btn-manual" class="mode-btn" onclick="artMode('manual')">✏ Ввести вручную</button>
    </div>

    <div id="art-upload-zone">
      <label style="cursor:pointer;display:block;border:2px dashed #d1d5db;border-radius:8px;padding:24px;text-align:center;color:#888;font-size:13px">
        <input type="file" id="art-file-input" accept=".docx" style="display:none" onchange="parseArticleFile(this)">
        📄 Перетащите докладную записку (.docx) или нажмите для выбора
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
          <span style="font-size:12px;font-weight:600;color:#444">Авторы и баллы</span>
          <span id="art-pts-total" style="font-size:12px;color:#888">0 / ${maxPts} б.</span>
        </div>
        <table class="data-table" style="margin-bottom:6px">
          <thead><tr><th>ФИО</th><th style="width:90px;text-align:center">Баллов</th><th style="width:28px"></th></tr></thead>
          <tbody id="art-authors-body"></tbody>
        </table>
        <button class="add-btn" onclick="addArtAuthorRow()">+ Автора</button>
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="addArticleToReport('${type}')">+ Добавить в отчёт</button>
      </div>
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
  pr.innerHTML = '<span style="color:#888;font-size:12px">Обработка...</span>';
  try {
    const resp = await fetch('/api/articles/parse', { method: 'POST', body: fd });
    if (!resp.ok) { const e = await resp.json().catch(()=>({detail:'Ошибка'})); pr.innerHTML = `<div class="err-box">${e.detail}</div>`; return; }
    const entries = await resp.json();
    _artDocxFilename = entries[0]?.docx_filename || null;
    if (entries.length === 1) {
      _fillArtForm(entries[0]); artMode('manual');
    } else {
      window._artParsedEntries = entries;
      pr.innerHTML = `<div style="font-size:12px;color:#555;margin-bottom:6px">Найдено статей: <b>${entries.length}</b>. Выберите нужную:</div>` +
        entries.map((e, i) => `<div onclick="artSelectEntry(${i})" style="padding:7px 10px;margin-bottom:4px;background:#f9f9f9;border:1px solid #e5e5e5;border-radius:6px;cursor:pointer">
          <div style="font-size:12px;font-weight:600">${e.title.substring(0,70)}${e.title.length>70?'…':''}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">${e.publication.substring(0,70)}</div>
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
    <td><button onclick="this.closest('tr').remove();updateArtPtsTotal()" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:14px">✕</button></td>`;
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
    el.style.color = sum > max ? '#dc2626' : (sum === max ? '#16a34a' : '#888');
  }
}

function addArticleToReport(type) {
  const title = document.getElementById('art-title').value.trim();
  const pub = document.getElementById('art-pub').value.trim();
  if (!title) { alert('Введите название статьи'); return; }

  // Collect authors
  const authorList = [];
  document.querySelectorAll('#art-authors-body tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const name = inputs[0].value.trim();
    const pts = parseFloat(inputs[1].value) || 0;
    if (name) authorList.push({ full_name: name, points: pts });
  });
  if (!authorList.length) { alert('Добавьте хотя бы одного автора'); return; }

  const maxPts = WEIGHTS[type] || 5;
  // В личный отчёт идут только баллы автора, совпадающего с профилем
  let myPts = myPointsFrom(authorList, 'points');
  myPts = Math.min(Math.max(myPts, 0), maxPts);
  if (myPts <= 0) { alert(noMyPointsMsg()); return; }

  const typeKey = type.replace('article_', '');
  const sub = ART_LABELS[typeKey] + (pub ? ' · ' + pub : '');

  if (state.editingItemKey) {
    const item = state.addedItems.find(i => i.key === state.editingItemKey);
    if (item) {
      item.label = title; item.sub = sub; item.pts = myPts;
      item.data = { title, publication: pub, article_type: typeKey, points_taken: myPts, author_list: authorList };
    }
    state.editingItemKey = null;
    updateScore(); closePanel();
    return;
  }

  const docxFn = _artDocxFilename || null;
  addItem('article', '📰', title, sub, myPts,
    { title, publication: pub, article_type: typeKey, points_taken: myPts, author_list: authorList, docx_filename: docxFn });
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
  addArtAuthorRow(p.last_name ? p.last_name + (initials ? ' ' + initials : '') : '', maxPts);
}

// ─── CONFERENCE PANEL (п.24) ─────────────────────────────────────────────────
// Доклад на конференции: документ не парсится — просто прикладывается как подтверждение.
let _confCertFilename = null;

function buildConferencePanel() {
  return `<div class="panel-title">Доклад на конференции (п.24 · 5 б.)
    <button class="btn btn-secondary btn-sm" onclick="closePanel()">✕ закрыть</button></div>
    <div class="form-grid" style="margin-bottom:12px">
      <div class="field full"><label>Конференция / тема доклада</label>
        <input type="text" id="conf-title" placeholder="Напр.: II Всероссийская НПК «…» — доклад «…»"></div>
    </div>
    <div class="field full" style="margin-bottom:12px">
      <label>Сертификат участия (изображение или PDF)</label>
      <label class="upload-label" id="conf-cert-label" style="display:inline-flex;margin-top:4px">
        <span>📎 Выбрать файл</span>
        <input type="file" accept="image/*,.pdf" style="display:none" onchange="uploadConferenceCert(this)">
      </label>
      <div style="font-size:11px;color:#aaa;margin-top:6px">Документ не распознаётся — прикладывается к отчёту и попадает в архив как подтверждение.</div>
    </div>
    <button class="btn btn-primary" onclick="addConferenceToReport()">✓ Добавить в отчёт</button>`;
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
    if (lbl) { lbl.className = 'upload-label has-file'; lbl.querySelector('span').textContent = '📎 ' + input.files[0].name; }
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

  addItem('conference', '🎤', label, 'п.24 · Доклад на конференции', pts, data);
  _confCertFilename = null;
  closePanel();
}

