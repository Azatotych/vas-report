// ─── ЕДИНЫЙ НАБОР ЛИНЕЙНЫХ ИКОНОК ───────────────────────────────────────────
// Тонкие stroke-иконки (как в сайдбаре/дашборде). Наследуют цвет через
// currentColor. Использование в шаблонах: ${ic('doc')}, размер ic('doc', 18).
const _ICON_PATHS = {
  doc:        '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h4"/>',
  file:       '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  paperclip:  '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8"/>',
  software:   '<rect x="2.5" y="4" width="19" height="14" rx="2"/><path d="M2.5 8h19"/><path d="M8 12l2 2-2 2M13.5 16H16"/>',
  article:    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h4"/>',
  conference: '<path d="M3 3h18"/><path d="M20 3v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V3"/><path d="M12 15v6M8.5 21h7"/>',
  order:      '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M9 4.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h5"/>',
  folder:     '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  upload:     '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  download:   '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  calendar:   '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  edit:       '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash:      '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check:      '<path d="M5 12l5 5L20 6"/>',
  close:      '<path d="M6 6l12 12M18 6 6 18"/>',
  warning:    '<path d="M12 3l9 16H3z"/><path d="M12 9v5M12 17h.01"/>',
  back:       '<path d="M15 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  reopen:     '<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-1"/>',
  grid:       '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list:       '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  wrench:     '<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17l3 3 5.5-5.5a4 4 0 0 0 5.2-5.2l-2.5 2.5-2-2z"/>',
  bell:       '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  inbox:      '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
};

function ic(name, size) {
  const s = size || 15;
  return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${_ICON_PATHS[name] || ''}</svg>`;
}
