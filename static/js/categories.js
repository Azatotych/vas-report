// ─── CATEGORY CATALOG ───────────────────────────────────────────────────────
// Полный перечень критериев результативности (из утверждённого макета).
// p — номинальная стоимость для справки (показывается у нереализованных пунктов).
// kind — задан только у реализованных пунктов: po | report | article | order.
// Реальная стоимость реализованных пунктов берётся из WEIGHTS (core.js).
const CAT_GROUPS = [
  { id: 'ped', label: 'Педагогическая деятельность', short: 'Педагог.' },
  { id: 'sci', label: 'Научная деятельность',        short: 'Научная'  },
  { id: 'oid', label: 'ОИД и публикации',            short: 'ОИД'      },
  { id: 'etc', label: 'Прочее',                       short: 'Прочее'   },
];

const CATEGORIES = [
  { n: '1',     p: 1,  g: 'ped', t: 'Проведение аудиторных занятий' },
  { n: '2.1',   p: 7,  g: 'ped', t: 'Учебное занятие на «отлично» (руководящий состав)' },
  { n: '2.2',   p: 3,  g: 'ped', t: 'Учебное занятие на «отлично» (преподавательский состав)' },
  { n: '3.1',   p: 30, g: 'ped', t: '«Лучший преподаватель» академии' },
  { n: '3.2',   p: 20, g: 'ped', t: '«Лучший преподаватель» группы кафедр' },
  { n: '3.3',   p: 15, g: 'ped', t: '«Лучший преподаватель» кафедры' },
  { n: '4.1.1', p: 10, g: 'ped', t: 'Олимпиада межвузовского уровня (1–3 место)' },
  { n: '4.1.2', p: 5,  g: 'ped', t: 'Олимпиада межвузовского уровня (4–10 место)' },
  { n: '4.2.1', p: 8,  g: 'ped', t: 'Олимпиада регионального уровня (1–3 место)' },
  { n: '4.2.2', p: 4,  g: 'ped', t: 'Олимпиада регионального уровня (4–10 место)' },
  { n: '4.3.1', p: 4,  g: 'ped', t: 'Иные олимпиады (1–3 место)' },
  { n: '4.3.2', p: 2,  g: 'ped', t: 'Иные олимпиады (4–10 место)' },
  { n: '5',     p: 10, g: 'ped', t: 'Завершение подготовки мастера спорта РФ' },
  { n: '6.1',   p: 30, g: 'ped', t: 'Учебная программа новой дисциплины (адъюнктура, магистратура)' },
  { n: '6.2',   p: 25, g: 'ped', t: 'Учебная программа новой дисциплины (специалитет, ДПО)' },
  { n: '6.3',   p: 20, g: 'ped', t: 'Учебная программа новой дисциплины (СПО)' },
  { n: '7.1',   p: 25, g: 'ped', t: 'Тематический план новой дисциплины (адъюнктура, магистратура)' },
  { n: '7.2',   p: 20, g: 'ped', t: 'Тематический план новой дисциплины (специалитет, ДПО)' },
  { n: '7.3',   p: 15, g: 'ped', t: 'Тематический план новой дисциплины (СПО)' },
  { n: '8',     p: 25, g: 'ped', t: 'Педагогический (методический) эксперимент и внедрение' },
  { n: '9.1',   p: 2,  g: 'ped', t: 'Доклад на учебно-методическом сборе' },
  { n: '9.2',   p: 1,  g: 'ped', t: 'Доклад на заседании учёного совета академии' },
  { n: '9.3',   p: 3,  g: 'ped', t: 'Методическое (открытое, пробное) занятие' },

  { n: '10.1',  p: 30, g: 'sci', t: 'Защита докторской диссертации' },
  { n: '10.2',  p: 25, g: 'sci', t: 'Защита кандидатской диссертации' },
  { n: '11.1',  p: 15, g: 'sci', t: 'Научное консультирование докторанта академии' },
  { n: '11.2',  p: 30, g: 'sci', t: 'Досрочная защита диссертации докторантом' },
  { n: '11.3',  p: 25, g: 'sci', t: 'Защита диссертации докторантом академии' },
  { n: '11.4',  p: 12, g: 'sci', t: 'Приём к защите диссертации докторанта' },
  { n: '12.1',  p: 10, g: 'sci', t: 'Научное руководство адъюнктом академии' },
  { n: '12.2',  p: 25, g: 'sci', t: 'Досрочная защита диссертации адъюнктом' },
  { n: '12.3',  p: 15, g: 'sci', t: 'Защита диссертации адъюнктом академии' },
  { n: '12.4',  p: 7,  g: 'sci', t: 'Приём к защите диссертации адъюнкта' },
  { n: '13',    p: 5,  g: 'sci', t: 'Руководство ВНШ (научным направлением), секретарь' },
  { n: '14.1',  p: 12, g: 'sci', t: 'Диссертационный совет (председатель / зам.)' },
  { n: '14.2',  p: 10, g: 'sci', t: 'Диссертационный совет, НТС (учёный секретарь)' },
  { n: '14.3',  p: 5,  g: 'sci', t: 'Диссертационный совет (член совета)' },
  { n: '14.4',  p: 3,  g: 'sci', t: 'Научно-технический совет' },
  { n: '14.5',  p: 2,  g: 'sci', t: 'Научно-теоретический семинар' },
  { n: '15.1',  p: 5,  g: 'sci', t: 'Испытания ВВСТ (государственные испытания)' },
  { n: '15.2',  p: 3,  g: 'sci', t: 'Испытания ВВСТ (прочие испытания)' },
  { n: '16',    p: 2,  g: 'sci', t: 'Руководство научной работой оператора роты' },
  { n: '17',    p: 1,  g: 'sci', t: 'Руководство ПИР воспитанника кадетского корпуса' },
  { n: '18',    p: 30, g: 'sci', t: 'Издание монографии' },
  { n: '19.1.1',p: 20, g: 'sci', t: 'Защита НИР 1 категории (научный руководитель)' },
  { n: '19.1.2',p: 15, g: 'sci', t: 'Защита НИР 1 категории (ответственный исполнитель)' },
  { n: '19.2.1',p: 15, g: 'sci', t: 'Защита НИР 2 категории (научный руководитель)' },
  { n: '19.2.2',p: 8,  g: 'sci', t: 'Защита НИР 2 категории (ответственный исполнитель)' },

  { n: '20',    p: 15, g: 'oid', t: 'Оформление изобретения / регистрация ПО (ФИПС)', kind: 'po' },
  { n: '21',    p: 12, g: 'oid', t: 'Проект, экспонируемый на выставке от академии' },
  { n: '22.1',  p: 15, g: 'oid', t: 'Руководство конференцией международного уровня' },
  { n: '22.2',  p: 12, g: 'oid', t: 'Руководство конференцией всероссийского уровня' },
  { n: '22.3',  p: 10, g: 'oid', t: 'Руководство конференцией регионального уровня' },
  { n: '22.4',  p: 8,  g: 'oid', t: 'Руководство конференцией уровня академии' },
  { n: '23.1',  p: 8,  g: 'oid', t: 'Руководство секцией конференции международного уровня' },
  { n: '23.2',  p: 6,  g: 'oid', t: 'Руководство секцией конференции всероссийского уровня' },
  { n: '23.3',  p: 5,  g: 'oid', t: 'Руководство секцией конференции регионального уровня' },
  { n: '23.4',  p: 4,  g: 'oid', t: 'Руководство секцией конференции уровня академии' },
  { n: '24',    p: 5,  g: 'oid', t: 'Выступление с докладом на конференции', kind: 'report' },
  { n: '25.1',  p: 7,  g: 'oid', t: 'Отзыв ведущей организации (докторская)' },
  { n: '25.2',  p: 5,  g: 'oid', t: 'Отзыв ведущей организации (кандидатская)' },
  { n: '25.3',  p: 2,  g: 'oid', t: 'Отзыв на автореферат докторской диссертации' },
  { n: '25.4',  p: 1,  g: 'oid', t: 'Отзыв на автореферат кандидатской диссертации' },
  { n: '26',    p: 2,  g: 'oid', t: 'Рецензирование монографий, учебников и пособий' },
  { n: '27.1',  p: 8,  g: 'oid', t: 'Выпуск публикации в издании по перечню ВАК, индексируемой в РИНЦ', kind: 'article' },
  { n: '27.2',  p: 5,  g: 'oid', t: 'Выпуск публикации, индексируемой в РИНЦ', kind: 'article' },
  { n: '27.3',  p: 5,  g: 'oid', t: 'Выпуск публикации в закрытом издании', kind: 'article' },

  { n: '28',    p: 2,  g: 'etc', t: 'Обязанности классного руководителя учебной группы' },
  { n: '29.1',  p: 1,  g: 'etc', t: 'Мероприятие по военно-профессиональной ориентации' },
  { n: '29.2',  p: 5,  g: 'etc', t: 'ВПО, обеспечившая прибытие кандидата' },
  { n: '30.1',  p: 7,  g: 'etc', t: 'Оперативное задание вышестоящего органа', kind: 'order' },
  { n: '30.2',  p: 4,  g: 'etc', t: 'Оперативное задание руководства ВАС', kind: 'order' },
  { n: '31',    p: 15, g: 'etc', t: 'Эффективное руководство кафедрой / НИО' },
];

const CAT_BY_N = Object.fromEntries(CATEGORIES.map(c => [c.n, c]));

function catPanelType(c) {
  if (!c || !c.kind) return null;
  if (c.kind === 'po')      return 'software';
  if (c.kind === 'report')  return 'conference';
  if (c.kind === 'order')   return c.n === '30.1' ? 'order_higher' : 'order_academy';
  if (c.kind === 'article') return c.n === '27.1' ? 'article_vak_rinc' : (c.n === '27.2' ? 'article_rinc' : 'article_closed');
  return null;
}
function catDisplayPts(c) {
  const type = catPanelType(c);
  return type ? (WEIGHTS[type] || c.p) : c.p;
}

// ─── LIST STATE ──────────────────────────────────────────────────────────────
let catFilter = 'avail';          // all | avail | ped | sci | oid | etc
let catQuery = '';
const _catCollapsed = {};         // groupId -> true if collapsed

const _CHEV_DOWN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const _LOCK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function setCatFilter(id) { catFilter = id; renderCategories(); }
function onCatSearch(v) { catQuery = (v || '').toLowerCase().trim(); renderCategories(); }
function toggleGroup(gid) { _catCollapsed[gid] = !_catCollapsed[gid]; renderCategories(); }

function _catMatches(c) {
  if (catQuery && !(`${c.n} ${c.t} ${catDisplayPts(c)}`.toLowerCase().includes(catQuery))) return false;
  if (catFilter === 'avail') return !!c.kind;
  if (catFilter !== 'all') return c.g === catFilter;
  return true;
}

function renderCategories() {
  const filtersEl = document.getElementById('cat-filters');
  if (filtersEl) {
    const chips = [{ id: 'avail', label: 'Доступные' }, { id: 'all', label: 'Все' },
      ...CAT_GROUPS.map(g => ({ id: g.id, label: g.short }))];
    filtersEl.innerHTML = chips.map(f =>
      `<button class="filter-chip${catFilter === f.id ? ' active' : ''}" onclick="setCatFilter('${f.id}')">${f.label}</button>`
    ).join('');
  }

  const list = document.getElementById('cat-list');
  if (!list) return;

  let html = '';
  for (const g of CAT_GROUPS) {
    const items = CATEGORIES.filter(c => c.g === g.id && _catMatches(c));
    if (!items.length) continue;
    const ready = items.filter(c => c.kind).length;
    const collapsed = !!_catCollapsed[g.id];
    html += `<div class="cat-group">
      <button class="cat-group-hdr" onclick="toggleGroup('${g.id}')">
        <span class="cat-group-label">${g.label}</span>
        <span class="cat-group-badge">${ready} активно</span>
        <span class="cat-group-rule"></span>
        <span class="cat-chev${collapsed ? ' collapsed' : ''}">${_CHEV_DOWN}</span>
      </button>`;
    if (!collapsed) {
      html += '<div class="cat-rows">';
      for (const c of items) {
        const avail = !!catPanelType(c);
        const open = state.openCat === c.n;
        html += `<div class="cat-item">
          <button class="cat-row${avail ? '' : ' wip'}${open ? ' open' : ''}" id="catrow-${c.n}"
                  onclick="${avail ? `toggleCat('${c.n}')` : 'wip()'}">
            <span class="cat-num">${c.n}</span>
            <span class="cat-name">${c.t}</span>
            <span class="cat-pts">${catDisplayPts(c)} б.</span>
            <span class="cat-end">${avail ? _CHEV_DOWN : _LOCK}</span>
          </button>
          ${avail ? `<div class="cat-expand" id="catx-${c.n}" style="display:none"></div>` : ''}
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  list.innerHTML = html || '<div class="empty-state">Ничего не найдено по запросу</div>';
}

// ─── INLINE EXPAND ───────────────────────────────────────────────────────────
function _collapseAllCats() {
  document.querySelectorAll('.cat-expand').forEach(e => { e.style.display = 'none'; e.innerHTML = ''; });
  document.querySelectorAll('.cat-row.open').forEach(e => e.classList.remove('open'));
}

function toggleCat(n) {
  const wasOpen = state.openCat === n;
  _collapseAllCats();
  state.currentPanel = null; state.editingItemKey = null; state.openCat = null;
  if (wasOpen) return;
  openCat(n);
}

function openCat(n) {
  const c = CAT_BY_N[n];
  const type = catPanelType(c);
  if (!type) return;
  if (state.openCat !== n) _collapseAllCats();
  state.openCat = n;
  state.currentPanel = type;
  const box = document.getElementById('catx-' + n);
  if (!box) return;
  box.innerHTML = panelHTML(type);
  box.style.display = '';
  const row = document.getElementById('catrow-' + n);
  if (row) row.classList.add('open');
  panelInit(type);
}
