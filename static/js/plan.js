// ─── ЛИЧНЫЙ ПЛАН РАБОТЫ (часы → docx) ───────────────────────────────────────
// Отдельный от результативности документооборот: годовой план, распределение
// по месяцам (front-fill + отпуск), конструктор месячного отчёта.
let planTab = 'annual';                       // annual | months | report
let planYear = new Date().getFullYear();
let planData = null;                          // бандл GET /plan
let planRD = null;                            // report-data конструктора
let planRepMonth = new Date().getMonth() + 1;
let _planFlushTimer = null;
let _planDirty = { fund: false, vacation: false, cells: false };
let _planOpRows = [];                         // разовые оперативки конструктора

function _planSplit(total, n) {
  if (n <= 0) return [];
  const base = Math.floor(total / n), r = total - base * n;
  return Array.from({ length: n }, (_, k) => base + (k < r ? 1 : 0));
}

function _nirShort(name) {
  const m = (name || '').match(/«([^»]+)»/);
  return m ? m[1] : (name || '').slice(0, 14);
}

async function loadPlan() {
  const pill = document.getElementById('plan-year-pill');
  if (pill) pill.textContent = planYear + ' год';
  planData = await api('GET', '/plan?year=' + planYear).catch(() => null);
  renderPlan();
}

function setPlanTab(t) { planTab = t; renderPlan(); }
function setPlanYear(y) { planYear = +y; loadPlan(); }

function renderPlan() {
  const el = document.getElementById('plan-body');
  if (!el) return;
  const tab = (id, label) =>
    `<button class="dep-tab ${planTab === id ? 'active' : ''}" onclick="setPlanTab('${id}')">${label}</button>`;
  const tabs = `<div class="dep-tabs" style="margin-bottom:16px">
    ${tab('annual', 'Годовой план')}${tab('months', 'Распределение')}${tab('report', 'Месячный отчёт')}
  </div>`;
  let body = '';
  if (planTab === 'annual') body = planAnnualHTML();
  else if (planTab === 'months') body = planMonthsHTML();
  else body = planReportShellHTML();
  el.innerHTML = tabs + body;
  if (planTab === 'months' && planData && planData.plan) _planRecalcTotals();
  if (planTab === 'report' && planData && planData.plan) initPlanReportTab();
}

// ════════ ТАБ 1: ГОДОВОЙ ПЛАН ═══════════════════════════════════════════════

function planAnnualHTML() {
  const p = (planData && planData.plan) || {};
  const months = (planData && planData.months) || [];
  const fund = {}; months.forEach(m => { fund[m.month] = m.fund_hours; });
  const yearOpts = [-1, 0, 1].map(d => {
    const y = new Date().getFullYear() + d;
    return `<option value="${y}" ${y === planYear ? 'selected' : ''}>${y}</option>`;
  }).join('');
  const fundInputs = MONTHS.slice(1).map((nm, i) =>
    `<div class="field"><label>${nm}</label>
     <input type="number" min="0" id="plan-fund-${i + 1}" value="${fund[i + 1] || 0}"></div>`).join('');

  let html = `
  <div class="card">
    <div class="card-header"><div class="card-title">Годовой план</div>
      <select id="plan-year-select" onchange="setPlanYear(this.value)" class="btn btn-secondary btn-sm">${yearOpts}</select>
    </div>
    <div class="card-body">
      ${!p.id ? `<div class="warn-box" style="margin-bottom:14px">${ic('warning')} План на ${planYear} год ещё не создан — заполните и сохраните. НИРы и вечные оперативки добавляются после сохранения.</div>` : ''}
      <div class="form-grid">
        <div class="field"><label>Статьи (ред.-изд. работа), ч/год</label>
          <input type="number" min="0" id="plan-h-articles" value="${p.hours_articles || 0}"></div>
        <div class="field"><label>Оперативные задания, ч/год</label>
          <input type="number" min="0" id="plan-h-operatives" value="${p.hours_operatives || 0}"></div>
        <div class="field"><label>Наряды (вне НР), ч/год</label>
          <input type="number" min="0" id="plan-h-naryady" value="${p.hours_naryady || 0}"></div>
        <div class="field"><label>Другие виды научной работы (ГУК), ч/год</label>
          <input type="number" min="0" id="plan-h-guk" value="${p.hours_guk || 0}"></div>
        <div class="field full"><label>ФИО в родительном падеже (для шапки: «Личный план … кого»)</label>
          <input type="text" id="plan-fio-gen" placeholder="Например: Иванова Ивана Ивановича" value="${p.fio_genitive || ''}"></div>
        <div class="field"><label>Утверждающий — должность</label>
          <input type="text" id="plan-appr-pos" value="${p.approver_position || 'Начальник 5 научно-исследовательского отдела'}"></div>
        <div class="field"><label>Звание</label>
          <input type="text" id="plan-appr-rank" value="${p.approver_rank || 'подполковник'}"></div>
        <div class="field"><label>И.Фамилия</label>
          <input type="text" id="plan-appr-name" value="${p.approver_name || 'С.Тихонов'}"></div>
      </div>
      <div style="margin:16px 0 6px;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4)">Фонд рабочего времени по месяцам (производственный календарь), ч</div>
      <div class="plan-fund-grid">${fundInputs}</div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" onclick="savePlanAnnual()">${ic('check')} Сохранить план</button>
        <div id="plan-annual-msg" style="display:none"></div>
      </div>
    </div>
  </div>`;

  if (p.id) {
    const nirs = planData.nirs || [];
    const dmOpts = sel => ['<option value="">без срока</option>']
      .concat(MONTHS.slice(1).map((nm, i) =>
        `<option value="${i + 1}" ${sel === i + 1 ? 'selected' : ''}>${nm}</option>`)).join('');
    html += `
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">НИРы (§1)</div></div>
      <div class="card-body">
        <table class="data-table">
          <tr><th style="width:48%">Наименование (полная строка для отчёта)</th><th>Сдача этапа</th><th>Часы/год</th><th></th></tr>
          ${nirs.map(n => `<tr>
            <td><input type="text" class="plan-inp-wide" id="nir-name-${n.id}" value="${(n.name || '').replace(/"/g, '&quot;')}"></td>
            <td><select id="nir-dm-${n.id}">${dmOpts(n.deadline_month)}</select></td>
            <td><input type="number" min="0" class="plan-inp-num" id="nir-h-${n.id}" value="${n.hours_year || 0}"></td>
            <td style="white-space:nowrap">
              <button class="btn btn-secondary btn-sm" onclick="savePlanNir(${n.id})" title="Сохранить">${ic('check')}</button>
              <button class="btn btn-danger btn-sm" onclick="deletePlanNir(${n.id})" title="Удалить">${ic('trash')}</button>
            </td></tr>`).join('')}
          <tr>
            <td><input type="text" class="plan-inp-wide" id="nir-name-new" placeholder="Выполнение работ в рамках … этапа НИР … шифр «…»"></td>
            <td><select id="nir-dm-new">${dmOpts(null)}</select></td>
            <td><input type="number" min="0" class="plan-inp-num" id="nir-h-new" value="0"></td>
            <td><button class="btn btn-primary btn-sm" onclick="addPlanNir()">+ Добавить</button></td>
          </tr>
        </table>
      </div>
    </div>`;

    const eops = planData.eternal_ops || [];
    html += `
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Вечные оперативки (§9, каждый месяц)</div></div>
      <div class="card-body">
        <table class="data-table">
          <tr><th>Тема (№ вх.)</th><th>Цель</th><th>Задачи</th><th>Результат</th><th>ч/мес</th><th></th></tr>
          ${eops.map(o => `<tr>
            <td><input type="text" class="plan-inp-mid" id="eop-name-${o.id}" value="${(o.name || '').replace(/"/g, '&quot;')}"></td>
            <td><input type="text" class="plan-inp-mid" id="eop-goal-${o.id}" value="${(o.goal || '').replace(/"/g, '&quot;')}"></td>
            <td><input type="text" class="plan-inp-mid" id="eop-tasks-${o.id}" value="${(o.tasks || '').replace(/"/g, '&quot;')}"></td>
            <td><input type="text" class="plan-inp-mid" id="eop-result-${o.id}" value="${(o.result || '').replace(/"/g, '&quot;')}"></td>
            <td><input type="number" min="0" class="plan-inp-num" id="eop-h-${o.id}" value="${o.hours_month || 0}"></td>
            <td style="white-space:nowrap">
              <button class="btn btn-secondary btn-sm" onclick="savePlanEop(${o.id})">${ic('check')}</button>
              <button class="btn btn-danger btn-sm" onclick="deletePlanEop(${o.id})">${ic('trash')}</button>
            </td></tr>`).join('')}
          <tr>
            <td><input type="text" class="plan-inp-mid" id="eop-name-new" placeholder="Входящий № … от …"></td>
            <td><input type="text" class="plan-inp-mid" id="eop-goal-new"></td>
            <td><input type="text" class="plan-inp-mid" id="eop-tasks-new"></td>
            <td><input type="text" class="plan-inp-mid" id="eop-result-new"></td>
            <td><input type="number" min="0" class="plan-inp-num" id="eop-h-new" value="0"></td>
            <td><button class="btn btn-primary btn-sm" onclick="addPlanEop()">+ Добавить</button></td>
          </tr>
        </table>
      </div>
    </div>`;
  }
  return html;
}

async function savePlanAnnual() {
  const g = id => +document.getElementById(id).value || 0;
  const body = {
    year: planYear,
    hours_articles: g('plan-h-articles'), hours_operatives: g('plan-h-operatives'),
    hours_naryady: g('plan-h-naryady'), hours_guk: g('plan-h-guk'),
    fio_genitive: document.getElementById('plan-fio-gen').value.trim(),
    approver_position: document.getElementById('plan-appr-pos').value.trim(),
    approver_rank: document.getElementById('plan-appr-rank').value.trim(),
    approver_name: document.getElementById('plan-appr-name').value.trim(),
    months: MONTHS.slice(1).map((_, i) => ({ month: i + 1, fund_hours: g('plan-fund-' + (i + 1)) })),
  };
  try {
    planData = await api('POST', '/plan', body);
    toast(ic('check') + ' План сохранён');
    renderPlan();
  } catch (e) { alert(e.message); }
}

async function addPlanNir() {
  const name = document.getElementById('nir-name-new').value.trim();
  if (!name) { alert('Укажите наименование НИР'); return; }
  const dm = document.getElementById('nir-dm-new').value;
  try {
    await api('POST', `/plan/${planData.plan.id}/nirs`, {
      name, deadline_month: dm ? +dm : null,
      hours_year: +document.getElementById('nir-h-new').value || 0,
    });
    await loadPlan();
  } catch (e) { alert(e.message); }
}

async function savePlanNir(id) {
  const dm = document.getElementById('nir-dm-' + id).value;
  try {
    await api('PUT', '/plan/nirs/' + id, {
      name: document.getElementById('nir-name-' + id).value.trim(),
      deadline_month: dm ? +dm : null,
      hours_year: +document.getElementById('nir-h-' + id).value || 0,
    });
    toast(ic('check') + ' НИР сохранена');
    planData = await api('GET', '/plan?year=' + planYear);
  } catch (e) { alert(e.message); }
}

async function deletePlanNir(id) {
  if (!confirm('Удалить НИР из плана (вместе с помесячной разбивкой)?')) return;
  try { await api('DELETE', '/plan/nirs/' + id); await loadPlan(); }
  catch (e) { alert(e.message); }
}

async function addPlanEop() {
  const name = document.getElementById('eop-name-new').value.trim();
  if (!name) { alert('Укажите тему оперативки'); return; }
  try {
    await api('POST', '/plan/eternal-ops', {
      name,
      goal: document.getElementById('eop-goal-new').value.trim(),
      tasks: document.getElementById('eop-tasks-new').value.trim(),
      result: document.getElementById('eop-result-new').value.trim(),
      hours_month: +document.getElementById('eop-h-new').value || 0,
    });
    await loadPlan();
  } catch (e) { alert(e.message); }
}

async function savePlanEop(id) {
  try {
    await api('PUT', '/plan/eternal-ops/' + id, {
      name: document.getElementById('eop-name-' + id).value.trim(),
      goal: document.getElementById('eop-goal-' + id).value.trim(),
      tasks: document.getElementById('eop-tasks-' + id).value.trim(),
      result: document.getElementById('eop-result-' + id).value.trim(),
      hours_month: +document.getElementById('eop-h-' + id).value || 0,
    });
    toast(ic('check') + ' Оперативка сохранена');
    planData = await api('GET', '/plan?year=' + planYear);
  } catch (e) { alert(e.message); }
}

async function deletePlanEop(id) {
  if (!confirm('Убрать вечную оперативку из плана?')) return;
  try { await api('DELETE', '/plan/eternal-ops/' + id); await loadPlan(); }
  catch (e) { alert(e.message); }
}

// ════════ ТАБ 2: РАСПРЕДЕЛЕНИЕ ══════════════════════════════════════════════

function _planBannerHTML() {
  const v = planData.vacation || {};
  const left = v.vacation_days_left || 0;
  const cls = left > 0 ? 'ok' : (left < 0 ? 'err' : 'ok');
  return `<div class="plan-banner ${cls}">
    <div class="plan-banner-main">Фонд ${v.fund_total || 0} ч − план ${v.plan_total || 0} ч = свободно ${v.free_hours || 0} ч
      → <b>${v.vacation_days_total || 0} дн. отпуска</b></div>
    <div class="plan-banner-sub">${left > 0
      ? `Осталось распределить <b>${left} дн.</b> — укажите дни отпуска в колонке «Отпуск»`
      : (left === 0 ? 'Весь отпуск распределён' : `Распределено на ${-left} дн. больше, чем позволяет план!`)}</div>
  </div>`;
}

function _planWarningsHTML() {
  const ws = (planData.warnings || []);
  if (!ws.length) return '';
  return `<div class="warn-box" style="margin-bottom:12px;flex-direction:column;align-items:stretch;gap:4px">
    ${ws.map(w => `<div>${ic('warning')} ${w.month ? MONTHS[w.month] + ': ' : ''}${w.message}</div>`).join('')}
  </div>`;
}

function planMonthsHTML() {
  if (!planData || !planData.plan) {
    return `<div class="warn-box">${ic('warning')} Сначала сохраните годовой план на вкладке «Годовой план».</div>`;
  }
  const nirs = planData.nirs || [];
  const byM = {}; (planData.months || []).forEach(r => { byM[r.month] = r; });

  const head = `<tr><th>Месяц</th><th>Фонд</th><th>Отпуск, дн</th>
    ${nirs.map(n => `<th title="${(n.name || '').replace(/"/g, '&quot;')}">${_nirShort(n.name)}</th>`).join('')}
    <th>ГУК</th><th>Статьи</th><th>Оперативки</th><th>Наряды</th><th>Итого</th></tr>`;

  const rows = MONTHS.slice(1).map((nm, i) => {
    const m = i + 1, r = byM[m] || {};
    const inp = (kind, val, extra) =>
      `<input type="number" min="0" class="plan-cell" data-kind="${kind}" data-month="${m}" ${extra || ''} value="${val || 0}" oninput="planCellInput(this)">`;
    return `<tr>
      <td style="font-family:var(--mono)">${nm}</td>
      <td>${inp('fund', r.fund_hours)}</td>
      <td>${inp('vacation', r.vacation_days)}</td>
      ${nirs.map(n => `<td>${inp('nir', (n.months || {})[m], `data-nir="${n.id}"`)}</td>`).join('')}
      <td>${inp('guk', r.hours_guk)}</td>
      <td>${inp('articles', r.hours_articles)}</td>
      <td>${inp('operatives', r.hours_operatives)}</td>
      <td>${inp('naryady', r.hours_naryady)}</td>
      <td class="plan-total" id="plan-total-${m}"></td>
    </tr>`;
  }).join('');

  return `
  <div id="plan-banner-wrap">${_planBannerHTML()}</div>
  <div id="plan-warnings-wrap">${_planWarningsHTML()}</div>
  <div class="card">
    <div class="card-header"><div class="card-title">Распределение по месяцам</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span id="plan-save-state" style="font-size:11px;color:var(--text-4)"></span>
        <button class="btn btn-primary btn-sm" onclick="planAutoDistribute()">Распределить автоматически</button>
      </div>
    </div>
    <div class="card-body" style="overflow-x:auto">
      <table class="data-table plan-table">${head}${rows}<tfoot id="plan-foot"></tfoot></table>
      <div style="margin-top:10px;font-size:11.5px;color:var(--text-4)">
        Ячейки можно править вручную — суммы и предупреждения пересчитаются автоматически.
        «Распределить автоматически» перезапишет все ячейки по правилам (front-fill, НИР к сроку сдачи, оперативки ≤ 30%).
      </div>
    </div>
  </div>`;
}

function _planRecalcTotals() {
  const nirs = (planData.nirs || []);
  const per = {};      // month -> {kind: val}
  document.querySelectorAll('.plan-cell').forEach(inp => {
    const m = +inp.dataset.month, k = inp.dataset.kind, v = +inp.value || 0;
    per[m] = per[m] || { nir: 0 };
    if (k === 'nir') per[m].nir += v; else per[m][k] = v;
  });
  const sums = { fund: 0, vacation: 0, nir: 0, guk: 0, articles: 0, operatives: 0, naryady: 0, total: 0 };
  for (let m = 1; m <= 12; m++) {
    const p = per[m] || {};
    const total = (p.nir || 0) + (p.guk || 0) + (p.articles || 0) + (p.operatives || 0) + (p.naryady || 0);
    const eff = Math.max(0, (p.fund || 0) - (p.vacation || 0) * 8);
    const cell = document.getElementById('plan-total-' + m);
    if (cell) {
      cell.textContent = total + ' / ' + eff;
      cell.className = 'plan-total' + (total > eff ? ' over' : (total < eff && total > 0 ? ' under' : ''));
    }
    sums.fund += p.fund || 0; sums.vacation += p.vacation || 0; sums.nir += p.nir || 0;
    sums.guk += p.guk || 0; sums.articles += p.articles || 0;
    sums.operatives += p.operatives || 0; sums.naryady += p.naryady || 0; sums.total += total;
  }
  const foot = document.getElementById('plan-foot');
  if (foot) {
    const pl = planData.plan;
    const nirTarget = (planData.nirs || []).reduce((s, n) => s + (n.hours_year || 0), 0);
    const chk = (got, want) => got === want ? `${got}` : `<span style="color:var(--danger)">${got}≠${want}</span>`;
    foot.innerHTML = `<tr style="font-family:var(--mono)">
      <td>ГОД</td><td>${sums.fund}</td><td>${sums.vacation} дн</td>
      <td colspan="${(planData.nirs || []).length}">${chk(sums.nir, nirTarget)}</td>
      <td>${chk(sums.guk, pl.hours_guk)}</td><td>${chk(sums.articles, pl.hours_articles)}</td>
      <td>${chk(sums.operatives, pl.hours_operatives)}</td><td>${chk(sums.naryady, pl.hours_naryady)}</td>
      <td>${sums.total}</td></tr>`;
  }
}

function planCellInput(inp) {
  const k = inp.dataset.kind;
  if (k === 'fund') _planDirty.fund = true;
  else if (k === 'vacation') _planDirty.vacation = true;
  else _planDirty.cells = true;
  _planRecalcTotals();
  const st = document.getElementById('plan-save-state');
  if (st) st.textContent = 'изменено…';
  clearTimeout(_planFlushTimer);
  _planFlushTimer = setTimeout(planFlush, 900);
}

function _planCollectTable() {
  const months = [];
  for (let m = 1; m <= 12; m++) months.push({ month: m });
  const nir_months = [];
  document.querySelectorAll('.plan-cell').forEach(inp => {
    const m = +inp.dataset.month, v = +inp.value || 0, k = inp.dataset.kind;
    const row = months[m - 1];
    if (k === 'fund') row.fund_hours = v;
    else if (k === 'vacation') row.vacation_days = v;
    else if (k === 'nir') nir_months.push({ nir_id: +inp.dataset.nir, month: m, hours: v });
    else row['hours_' + k] = v;
  });
  return { months, nir_months };
}

async function planFlush() {
  if (!planData || !planData.plan) return;
  const pid = planData.plan.id;
  const { months, nir_months } = _planCollectTable();
  const st = document.getElementById('plan-save-state');
  try {
    if (_planDirty.fund) {
      const p = planData.plan;
      await api('POST', '/plan', {
        year: planYear, hours_articles: p.hours_articles, hours_operatives: p.hours_operatives,
        hours_naryady: p.hours_naryady, hours_guk: p.hours_guk, fio_genitive: p.fio_genitive,
        approver_position: p.approver_position, approver_rank: p.approver_rank,
        approver_name: p.approver_name,
        months: months.map(r => ({ month: r.month, fund_hours: r.fund_hours || 0 })),
      });
    }
    if (_planDirty.vacation) await api('PUT', `/plan/${pid}/vacation`, { months });
    if (_planDirty.cells) await api('PUT', `/plan/${pid}/cells`, { months, nir_months });
    _planDirty = { fund: false, vacation: false, cells: false };
    planData = await api('GET', '/plan?year=' + planYear);
    const bw = document.getElementById('plan-banner-wrap');
    if (bw) bw.innerHTML = _planBannerHTML();
    const ww = document.getElementById('plan-warnings-wrap');
    if (ww) ww.innerHTML = _planWarningsHTML();
    if (st) st.textContent = 'сохранено';
  } catch (e) {
    if (st) st.textContent = 'ошибка сохранения';
    toast(ic('warning') + ' ' + e.message);
  }
}

async function planAutoDistribute() {
  if (!planData || !planData.plan) return;
  if (!confirm('Перезаписать распределение по месяцам автоматически? Ручные правки будут потеряны.')) return;
  try {
    clearTimeout(_planFlushTimer);
    await planFlush();          // сохранить фонд/отпуск перед пересчётом
    planData = await api('POST', `/plan/${planData.plan.id}/distribute`);
    renderPlan();
    const dw = planData.distribute_warnings || [];
    toast(ic('check') + ' Распределено' + (dw.length ? ` (${dw.length} предупр.)` : ''));
  } catch (e) { alert(e.message); }
}

// ════════ ТАБ 3: МЕСЯЧНЫЙ ОТЧЁТ ═════════════════════════════════════════════

function planReportShellHTML() {
  if (!planData || !planData.plan) {
    return `<div class="warn-box">${ic('warning')} Сначала сохраните годовой план и распределите часы по месяцам.</div>`;
  }
  const mOpts = MONTHS.slice(1).map((nm, i) =>
    `<option value="${i + 1}" ${i + 1 === planRepMonth ? 'selected' : ''}>${nm}</option>`).join('');
  return `
  <div class="card">
    <div class="card-header">
      <div class="card-title">Конструктор отчёта</div>
      <select class="btn btn-secondary btn-sm" onchange="planRepMonth=+this.value;initPlanReportTab()">${mOpts}</select>
    </div>
    <div class="card-body" id="plan-rep-body">Загрузка…</div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-header"><div class="card-title">Сформированные отчёты</div></div>
    <div class="card-body" id="plan-rep-list">—</div>
  </div>`;
}

async function initPlanReportTab() {
  await Promise.all([loadPlanReportData(), loadPlanReportsList()]);
}

async function loadPlanReportData() {
  const el = document.getElementById('plan-rep-body');
  if (!el) return;
  try {
    planRD = await api('GET', `/plan/report-data?year=${planYear}&month=${planRepMonth}`);
  } catch (e) {
    el.innerHTML = `<div class="warn-box">${ic('warning')} ${e.message}</div>`;
    return;
  }
  _planOpRows = [];
  (planRD.existing_items || []).filter(i => i.kind === 'operative').forEach(i => _planOpRows.push({
    name: i.name, goal: i.goal, tasks: i.tasks, result: i.result, hours: i.hours,
  }));
  el.innerHTML = _planRepHTML();
  _planPrefillChecks();
  _planRepRecalc();
}

function _planRepHTML() {
  const d = planRD;
  const cand = d.candidates || {};
  const row = (kind, c, label) => `
    <label class="plan-cand">
      <input type="checkbox" data-kind="${kind}" data-id="${c.id}"
        data-name="${(label || c.title || '').replace(/"/g, '&quot;')}" onchange="planItemToggle()">
      <span class="plan-cand-title">${label || c.title || '—'}</span>
      <input type="number" min="0" class="plan-inp-num plan-cand-h" id="pih-${kind}-${c.id}" value="0"
        oninput="_planRepRecalc()" disabled>
    </label>`;
  return `
  <div class="plan-rep-info">
    <span>Норма месяца: <b>${d.norm} ч</b></span>
    <span>НИРы: <b>${d.nir_rows.reduce((s, r) => s + r.hours, 0)} ч</b></span>
    <span>Вечные оперативки: <b>${d.eternal_total} ч</b></span>
    <span>Наряды: <b>${d.budgets.naryady} ч</b></span>
    <span>ГУК: <b>${d.budgets.guk} ч</b></span>
  </div>
  ${d.nir_rows.length ? `<table class="data-table" style="margin-bottom:14px">
    <tr><th>НИР (проставлено из распределения)</th><th style="width:80px">Часы</th></tr>
    ${d.nir_rows.map(r => `<tr><td>${r.name}</td><td style="font-family:var(--mono)">${r.hours}</td></tr>`).join('')}
  </table>` : `<div class="warn-box" style="margin-bottom:14px">${ic('warning')} В этом месяце нет часов НИР — проверьте вкладку «Распределение».</div>`}

  <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4);margin-bottom:6px">
    Статьи · ПО · конференции — выберите из картотеки (бюджет статей: ${d.budgets.articles} ч)</div>
  <div class="plan-cand-list">
    ${(cand.articles || []).map(c => row('article', c, 'Статья: ' + c.title)).join('')}
    ${(cand.software || []).map(c => row('software', c, 'ПО (ФИПС): ' + c.title)).join('')}
    ${(cand.conferences || []).map(c => row('conference', c, 'Конференция: ' + c.title)).join('')}
    ${!(cand.articles || []).length && !(cand.software || []).length && !(cand.conferences || []).length
      ? '<div style="color:var(--text-4);font-size:12.5px">В картотеке пока пусто — статьи и ПО добавляются в разделе «Картотека РИД», конференции — в отчётах результативности.</div>' : ''}
  </div>

  <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4);margin:16px 0 6px">
    Разовые оперативные задания (бюджет: ${d.budgets.op_flex} ч)</div>
  <div id="plan-op-rows"></div>
  <button class="btn btn-secondary btn-sm" onclick="planAddOpRow()">+ Оперативка</button>

  <div class="plan-rep-summary" id="plan-rep-summary"></div>
  <div style="margin-top:14px">
    <button class="btn btn-primary" onclick="planGenerateReport()">${ic('download')} Сформировать и скачать docx</button>
  </div>`;
}

function _planPrefillChecks() {
  (planRD.existing_items || []).forEach(it => {
    if (it.kind === 'operative' || !it.ref_id) return;
    const cb = document.querySelector(`input[data-kind="${it.kind}"][data-id="${it.ref_id}"]`);
    if (cb) {
      cb.checked = true;
      const h = document.getElementById(`pih-${it.kind}-${it.ref_id}`);
      if (h) { h.disabled = false; h.value = it.hours; }
    }
  });
  _planRenderOpRows();
}

function planItemToggle() {
  // авто-раскладка бюджета статей между всеми выбранными (статьи+ПО+конференции)
  const checked = [...document.querySelectorAll('.plan-cand input[type=checkbox]:checked')];
  const parts = _planSplit(planRD.budgets.articles, checked.length);
  document.querySelectorAll('.plan-cand input[type=checkbox]').forEach(cb => {
    const h = document.getElementById(`pih-${cb.dataset.kind}-${cb.dataset.id}`);
    if (!h) return;
    if (cb.checked) { h.disabled = false; h.value = parts[checked.indexOf(cb)]; }
    else { h.disabled = true; h.value = 0; }
  });
  _planRepRecalc();
}

function planAddOpRow() {
  _planOpRows.push({ name: '', goal: 'Выполнение указаний руководителя', tasks: 'Выполнение поставленных задач', result: 'Материалы представлены', hours: 0 });
  _planAutoOpHours();
  _planRenderOpRows();
}

function planRmOpRow(i) {
  _planOpRows.splice(i, 1);
  _planAutoOpHours();
  _planRenderOpRows();
}

function _planAutoOpHours() {
  const parts = _planSplit(planRD.budgets.op_flex, _planOpRows.length);
  _planOpRows.forEach((r, i) => { r.hours = parts[i]; });
}

function planOpInput(i, field, val) {
  _planOpRows[i][field] = field === 'hours' ? (+val || 0) : val;
  if (field === 'hours') _planRepRecalc();
}

function _planRenderOpRows() {
  const el = document.getElementById('plan-op-rows');
  if (!el) return;
  el.innerHTML = _planOpRows.map((r, i) => `
    <div class="plan-op-row">
      <input type="text" class="plan-inp-mid" placeholder="Тема (№ исх. руководителя ОВУ)" value="${(r.name || '').replace(/"/g, '&quot;')}" oninput="planOpInput(${i},'name',this.value)">
      <input type="text" class="plan-inp-mid" placeholder="Цель" value="${(r.goal || '').replace(/"/g, '&quot;')}" oninput="planOpInput(${i},'goal',this.value)">
      <input type="text" class="plan-inp-mid" placeholder="Задачи" value="${(r.tasks || '').replace(/"/g, '&quot;')}" oninput="planOpInput(${i},'tasks',this.value)">
      <input type="text" class="plan-inp-mid" placeholder="Результат" value="${(r.result || '').replace(/"/g, '&quot;')}" oninput="planOpInput(${i},'result',this.value)">
      <input type="number" min="0" class="plan-inp-num" value="${r.hours || 0}" oninput="planOpInput(${i},'hours',this.value)">
      <button class="btn btn-danger btn-sm" onclick="planRmOpRow(${i})">${ic('trash')}</button>
    </div>`).join('');
  _planRepRecalc();
}

function _planRepRecalc() {
  const el = document.getElementById('plan-rep-summary');
  if (!el || !planRD) return;
  let creative = 0;
  document.querySelectorAll('.plan-cand input[type=checkbox]:checked').forEach(cb => {
    const h = document.getElementById(`pih-${cb.dataset.kind}-${cb.dataset.id}`);
    creative += +((h || {}).value) || 0;
  });
  const ops = _planOpRows.reduce((s, r) => s + (+r.hours || 0), 0);
  const ok1 = creative === planRD.budgets.articles, ok2 = ops === planRD.budgets.op_flex;
  el.innerHTML = `
    <span class="${ok1 ? 'plan-sum-ok' : 'plan-sum-warn'}">Статьи/ПО/конференции: ${creative} / ${planRD.budgets.articles} ч</span>
    <span class="${ok2 ? 'plan-sum-ok' : 'plan-sum-warn'}">Разовые оперативки: ${ops} / ${planRD.budgets.op_flex} ч</span>`;
}

function collectPlanItems() {
  const items = [];
  document.querySelectorAll('.plan-cand input[type=checkbox]:checked').forEach(cb => {
    const h = document.getElementById(`pih-${cb.dataset.kind}-${cb.dataset.id}`);
    items.push({
      kind: cb.dataset.kind, ref_id: +cb.dataset.id,
      name: (cb.dataset.name || '').replace(/^(Статья|ПО \(ФИПС\)|Конференция): /, ''),
      hours: +((h || {}).value) || 0,
    });
  });
  _planOpRows.forEach(r => {
    if ((r.name || '').trim()) items.push({ kind: 'operative', ...r });
  });
  return items;
}

async function planGenerateReport() {
  try {
    const r = await api('POST', '/plan/reports', {
      year: planYear, month: planRepMonth, items: collectPlanItems(),
    });
    toast(ic('check') + ' Отчёт сформирован');
    window.location.href = `/api/plan/reports/${r.id}/download`;
    loadPlanReportsList();
  } catch (e) { alert(e.message); }
}

async function loadPlanReportsList() {
  const el = document.getElementById('plan-rep-list');
  if (!el) return;
  const list = await api('GET', '/plan/reports').catch(() => []);
  if (!list.length) { el.innerHTML = '<div style="color:var(--text-4);font-size:12.5px">Отчёты ещё не формировались</div>'; return; }
  el.innerHTML = `<table class="data-table">
    ${list.map(r => `<tr>
      <td>${MONTHS[r.month]} ${r.year}</td>
      <td style="color:var(--text-4);font-size:12px">создан ${(r.created_at || '').slice(0, 16)}</td>
      <td style="text-align:right;white-space:nowrap">
        <a class="btn btn-secondary btn-sm" href="/api/plan/reports/${r.id}/download">${ic('download')} Скачать</a>
        <button class="btn btn-danger btn-sm" onclick="deletePlanReport(${r.id})">${ic('trash')}</button>
      </td></tr>`).join('')}
  </table>`;
}

async function deletePlanReport(id) {
  if (!confirm('Удалить сформированный отчёт?')) return;
  try { await api('DELETE', '/plan/reports/' + id); loadPlanReportsList(); }
  catch (e) { alert(e.message); }
}
