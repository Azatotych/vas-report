// ─── BATCH UPLOAD ──────────────────────────────────────────────────────────
function buildBatchPanel() {
  return `<div class="panel-title">📂 Загрузить из Докладной записки
    <button class="btn btn-secondary btn-sm" onclick="closePanel()">✕ закрыть</button></div>
  <div id="batch-drop" class="upload-zone"
       ondrop="onBatchDrop(event)" ondragover="event.preventDefault()"
       onclick="document.getElementById('batch-file-input').click()"
       style="margin-bottom:14px;cursor:pointer;padding:28px">
    <div style="font-size:28px;margin-bottom:6px">📂</div>
    <div style="font-weight:500;margin-bottom:4px">Перетащите Докладную записку сюда</div>
    <div style="font-size:11px;color:#aaa">или нажмите · принимает несколько файлов .docx</div>
    <input type="file" id="batch-file-input" accept=".docx" multiple style="display:none" onchange="startBatchParse(this.files)">
  </div>
  <div id="batch-status" style="font-size:12px;color:#888;margin-bottom:10px;display:none"></div>
  <div id="batch-list"></div>
  <div id="batch-add-all" style="display:none;margin-top:14px">
    <button class="btn btn-primary" onclick="addAllBatchItems()">✓ Добавить всё в отчёт</button>
  </div>`;
}

function onBatchDrop(event) {
  event.preventDefault();
  const files = event.dataTransfer.files;
  if (files.length) startBatchParse(files);
}

async function startBatchParse(files) {
  const status = document.getElementById('batch-status');
  const list   = document.getElementById('batch-list');
  if (!status || !list) return;
  status.style.display = '';
  status.textContent = 'Обработка…';
  list.innerHTML = '';
  document.getElementById('batch-add-all').style.display = 'none';

  const fd = new FormData();
  Array.from(files).forEach(f => fd.append('files', f));
  try {
    const resp = await fetch('/api/parse/batch', { method: 'POST', body: fd });
    if (!resp.ok) { const e = await resp.json().catch(()=>({detail:'Ошибка'})); status.textContent = e.detail; return; }
    const items = await resp.json();
    if (!items.length) { status.textContent = 'Ни одной записи не распознано'; return; }
    // pre-compute pts from %
    items.forEach(item => {
      const maxPts = item.kind === 'software' ? 5 : (item.article_type === 'vak_rinc' ? 8 : 5);
      const authors = item.authors || [];
      const totalPct = sumPct(authors);
      authors.forEach(a => { a._pts = pctToPts(a.contribution_percent, totalPct, maxPts); });
      item._added = false;
    });
    window._batchItems = items;
    status.textContent = `Распознано: ${items.length} позиц. (${items.filter(i=>i.kind==='software').length} ПО, ${items.filter(i=>i.kind==='article').length} статей)`;
    renderBatchList(items);
  } catch(err) { status.textContent = 'Ошибка: ' + err.message; }
}

function renderBatchList(items) {
  document.getElementById('batch-list').innerHTML = items.map((item, i) => {
    const myPts = myPointsFrom(item.authors, '_pts');
    const kindCls = item.kind === 'software' ? 'bk-sw' : 'bk-art';
    const kindLbl = item.kind === 'software' ? 'ПО' : (ART_LABELS[item.article_type] || 'РИНЦ');
    return `<div class="batch-card" id="bcard-${i}">
      <div class="batch-card-hdr" onclick="toggleBatchCard(${i})">
        <span class="batch-kind ${kindCls}">${kindLbl}</span>
        <span class="batch-title" title="${item.title}">${item.title.length>65 ? item.title.substring(0,65)+'…' : item.title}</span>
        <span class="batch-pts">Мои: ${myPts} б.</span>
        <span class="batch-chev" id="bchev-${i}">▼</span>
      </div>
      <div class="batch-card-body" id="bbody-${i}" style="display:none">${buildBatchBody(item, i)}</div>
    </div>`;
  }).join('');
  document.getElementById('batch-add-all').style.display = '';
}

function buildBatchBody(item, idx) {
  const maxPts = item.kind === 'software' ? 5 : (item.article_type === 'vak_rinc' ? 8 : 5);
  let typeRow = '';
  if (item.kind === 'article') {
    typeRow = `<div style="margin-bottom:10px;font-size:12px">Тип:
      <select onchange="setBatchArtType(${idx},this.value)" style="margin-left:6px;padding:2px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px">
        <option value="rinc"     ${item.article_type==='rinc'    ?'selected':''}>РИНЦ (п.27.2 · 5 б.)</option>
        <option value="vak_rinc" ${item.article_type==='vak_rinc'?'selected':''}>ВАК+РИНЦ (п.27.1 · 8 б.)</option>
        <option value="closed"   ${item.article_type==='closed'  ?'selected':''}>Закрытое (п.27.3 · 5 б.)</option>
      </select></div>`;
  }
  const rows = (item.authors||[]).map((a, ai) => `
    <div class="batch-author-row">
      <span>${a.full_name}</span>
      <span style="color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.position||''}</span>
      <span style="color:#aaa;text-align:right">${a.contribution_percent||0}%</span>
      <input type="number" value="${a._pts||0}" min="0" max="${maxPts}" step="0.5"
             onchange="setBatchAuthorPts(${idx},${ai},parseFloat(this.value)||0)"
             style="width:58px;padding:2px 5px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;text-align:center">
      <span style="font-size:11px;color:#888">б.</span>
    </div>`).join('');
  return `${typeRow}<div style="margin-bottom:10px">${rows}</div>
    <button class="btn btn-primary btn-sm" onclick="addBatchItem(${idx})">✓ Добавить в отчёт</button>`;
}

function toggleBatchCard(idx) {
  const body = document.getElementById('bbody-'+idx);
  const chev = document.getElementById('bchev-'+idx);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (chev) chev.textContent = open ? '▼' : '▲';
}

function setBatchArtType(idx, type) {
  const item = (window._batchItems||[])[idx];
  if (!item) return;
  item.article_type = type;
  const maxPts = type === 'vak_rinc' ? 8 : 5;
  const totalPct = sumPct(item.authors);
  (item.authors||[]).forEach(a => { a._pts = pctToPts(a.contribution_percent, totalPct, maxPts); });
  document.getElementById('bbody-'+idx).innerHTML = buildBatchBody(item, idx);
  // Update header badge and pts
  const card = document.getElementById('bcard-'+idx);
  if (card) {
    const myPts = myPointsFrom(item.authors, '_pts');
    card.querySelector('.batch-kind').textContent = ART_LABELS[type]||'РИНЦ';
    card.querySelector('.batch-pts').textContent = 'Мои: '+myPts+' б.';
  }
}

function setBatchAuthorPts(idx, ai, val) {
  const item = (window._batchItems||[])[idx];
  if (item && item.authors && item.authors[ai] !== undefined) item.authors[ai]._pts = val;
}

async function addBatchItem(idx) {
  const item = (window._batchItems||[])[idx];
  if (!item || item._added) return;
  const authors = item.authors || [];
  const myPts = myPointsFrom(authors, '_pts');
  if (myPts <= 0) { alert(noMyPointsMsg()); return; }
  try {
    if (item.kind === 'software') {
      const swAuthors = authors.map(a => ({ full_name: a.full_name, position: a.position||'', contribution_percent: a.contribution_percent||0, points_claimed: a._pts||0 }));
      addItem('software','💻', item.title, 'ПО · п.27.2', myPts,
        { title: item.title, certificate_number: item.certificate_number||'', registration_date: item.registration_date||'',
          output_data: item.output_data||'', docx_filename: item.docx_filename||'', authors: swAuthors, points_claimed: myPts });
    } else {
      const typeKey = item.article_type || 'rinc';
      const artAuthors = authors.map(a => ({ full_name: a.full_name, points: a._pts||0 }));
      const pub = item.publication || '';
      addItem('article','📰', item.title, ART_LABELS[typeKey]+(pub?' · '+pub:''), myPts,
        { title: item.title, publication: pub, article_type: typeKey, points_taken: myPts,
          author_list: artAuthors, docx_filename: item.docx_filename||'' });
    }
    item._added = true;
    const card = document.getElementById('bcard-'+idx);
    if (card) card.classList.add('batch-added');
  } catch(e) { alert('Ошибка: '+e.message); }
}

async function addAllBatchItems() {
  const items = window._batchItems || [];
  let added = 0, skipped = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i]._added) continue;
    if (myPointsFrom(items[i].authors, '_pts') <= 0) { skipped++; continue; }
    await addBatchItem(i);
    added++;
  }
  if (added === 0 && skipped > 0) { alert(noMyPointsMsg()); return; }
  if (skipped > 0) alert(`Добавлено: ${added}. Пропущено (нет ваших баллов): ${skipped}.`);
}

