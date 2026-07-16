# -*- coding: utf-8 -*-
"""Генерация месячного «Личного плана работы» (.docx) из template_plan.docx.

Порт подхода generate.py скилла mesyachny-otchet: точечная правка word/document.xml
(токены + клонирование строк-образцов regex-ом). Хелперы перенесены как есть —
шаблон без вложенных таблиц, подход на нём проверен. Упаковка — через zipfile
в память (без внешнего zip, работает на Windows).
"""
import html
import io
import re
import zipfile
from pathlib import Path

TEMPLATE = Path(__file__).parent / "template_plan.docx"

MONTHS_RU = ["", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
             "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

GUK_LABEL = "Оценка эффективности деятельности (по линии ГУК)"


# ── хелперы из generate.py (байт-в-байт) ─────────────────────────────────────

def esc(s):
    return html.escape(str(s), quote=True)


def run20(text, italic=False):
    it = "<w:i/><w:iCs/>" if italic else ""
    return ('<w:r><w:rPr>%s<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
            '<w:t xml:space="preserve">%s</w:t></w:r>' % (it, esc(text)))


def set_cell(tc_xml, text, italic=False):
    """Пересобрать <w:tc>: сохранить tcPr и pPr первого абзаца, вписать текст."""
    m = re.search(r"<w:tcPr>.*?</w:tcPr>", tc_xml, re.S)
    tcpr = m.group(0) if m else ""
    m = re.search(r"<w:p\b[^>]*>\s*(<w:pPr>.*?</w:pPr>)", tc_xml, re.S)
    ppr = m.group(1) if m else '<w:pPr><w:jc w:val="center"/></w:pPr>'
    body = run20(text, italic) if text != "" else ""
    return "<w:tc>%s<w:p>%s%s</w:p></w:tc>" % (tcpr, ppr, body)


def cells_of(row_xml):
    return re.findall(r"<w:tc>.*?</w:tc>", row_xml, re.S)


def table_after(doc, heading):
    """Вернуть (start, end, xml) первой таблицы после текста heading."""
    i = doc.find(heading)
    if i < 0:
        raise ValueError("heading not found: " + heading)
    s = doc.find("<w:tbl>", i)
    e = doc.find("</w:tbl>", s) + len("</w:tbl>")
    return s, e, doc[s:e]


def rows_of(tbl_xml):
    return re.findall(r"<w:tr\b.*?</w:tr>", tbl_xml, re.S)


def split_hours(total, n):
    if n <= 0:
        return []
    base = total // n
    r = total - base * n
    return [base + (1 if k < r else 0) for k in range(n)]


# ── работа с таблицей, содержащей строку-образец с токеном ───────────────────

def _table_of_marker(doc, marker):
    """(start, end, tbl_xml) таблицы, содержащей marker."""
    i = doc.find(marker)
    if i < 0:
        raise ValueError("marker not found: " + marker)
    s = doc.rfind("<w:tbl>", 0, i)
    e = doc.find("</w:tbl>", i) + len("</w:tbl>")
    return s, e, doc[s:e]


def _replace_sample_rows(doc, marker, make_rows):
    """В таблице с marker: строки до образца сохранить, образец заменить
    на make_rows(sample_xml) (список строк <w:tr>)."""
    s, e, tbl = _table_of_marker(doc, marker)
    rr = rows_of(tbl)
    idx = next(i for i, r in enumerate(rr) if marker in r)
    head = tbl[:tbl.find("<w:tr")]
    new_rows = rr[:idx] + make_rows(rr[idx]) + rr[idx + 1:]
    return doc[:s] + head + "".join(new_rows) + "</w:tbl>" + doc[e:]


def _simple_rows(sample, items):
    """Строки вида (№ | название | часы) из образца; items = [(name, hours)].
    Пустой список -> одна пустая строка (чистый образец)."""
    sc = cells_of(sample)
    if not items:
        c = sc[:]
        c[0] = set_cell(c[0], "")
        c[1] = set_cell(c[1], "")
        c[2] = set_cell(c[2], "")
        return ["<w:tr>" + "".join(c) + "</w:tr>"]
    out = []
    for n, (name, hours) in enumerate(items, 1):
        c = sc[:]
        c[0] = set_cell(c[0], n)
        c[1] = set_cell(c[1], name)
        c[2] = set_cell(c[2], hours)
        out.append("<w:tr>" + "".join(c) + "</w:tr>")
    return out


# ── основной генератор ───────────────────────────────────────────────────────

def generate_plan_docx(ctx):
    """Собрать docx. ctx:
      month (1-12), year,
      fio_rp, fio_sign, position,
      appr_position, appr_rank, appr_name,
      resource_year, nr_year, resource_month, nr_month,
      nirs=[(name, hours)], conferences=[(name, hours)],
      articles=[(name, hours)], software=[(name, hours)],
      guk_hours, naryad_hours,
      eternal_ops=[{name, goal, tasks, result, doc, hours}],
      operatives=[{name, goal, tasks, result, hours}]
    -> bytes
    """
    zin = zipfile.ZipFile(TEMPLATE)
    doc = zin.read("word/document.xml").decode("utf-8")

    month = int(ctx["month"])
    year = int(ctx["year"])
    appr_m = month - 1 if month > 1 else 12
    appr_y = year if month > 1 else year - 1

    # 1) простые токены
    repl = {
        "{{МЕСЯЦ}}": MONTHS_RU[month],
        "{{ГОД}}": str(year),
        "{{МЕСЯЦ_УТВ}}": MONTHS_RU[appr_m],
        "{{ГОД_УТВ}}": str(appr_y),
        "{{РЕСУРС_МЕС}}": str(ctx["resource_month"]),
        "{{НР_МЕС}}": str(ctx["nr_month"]),
        "{{РЕСУРС_ГОД}}": str(ctx["resource_year"]),
        "{{НР_ГОД}}": str(ctx["nr_year"]),
        "{{ФИО_РП}}": ctx.get("fio_rp", ""),
        "{{ФИО_ПОДПИСЬ}}": ctx.get("fio_sign", ""),
        "{{ДОЛЖНОСТЬ}}": ctx.get("position", ""),
        "{{УТВ_ДОЛЖНОСТЬ}}": ctx.get("appr_position", ""),
        "{{УТВ_ЗВАНИЕ}}": ctx.get("appr_rank", ""),
        "{{УТВ_ФИО}}": ctx.get("appr_name", ""),
    }
    for k, v in repl.items():
        doc = doc.replace(k, esc(v))

    # 2) §1 НИРы (образец: {{НИР_НАЗВАНИЕ}})
    doc = _replace_sample_rows(doc, "{{НИР_НАЗВАНИЕ}}",
                               lambda smp: _simple_rows(smp, ctx.get("nirs") or []))

    # 3) §3 конференции (первая таблица после заголовка; образец — пустая строка rr[1])
    s, e, tbl = table_after(doc, "конференциях (форумах, семинарах, пленумах)")
    rr = rows_of(tbl)
    head = tbl[:tbl.find("<w:tr")]
    new = rr[:1] + _simple_rows(rr[1], ctx.get("conferences") or [])
    doc = doc[:s] + head + "".join(new) + "</w:tbl>" + doc[e:]

    # 4) §4 статьи
    s, e, tbl = table_after(doc, "Разработка научных трудов")
    rr = rows_of(tbl)
    head = tbl[:tbl.find("<w:tr")]
    new = rr[:1] + _simple_rows(rr[1], ctx.get("articles") or [])
    doc = doc[:s] + head + "".join(new) + "</w:tbl>" + doc[e:]

    # 5) §5 ПО (образец: {{ПО_НАЗВАНИЕ}})
    doc = _replace_sample_rows(doc, "{{ПО_НАЗВАНИЕ}}",
                               lambda smp: _simple_rows(smp, ctx.get("software") or []))

    # 6) §7 другие виды научной работы (ГУК)
    s, e, tbl = table_after(doc, "Другие виды научной работы")
    rr = rows_of(tbl)
    head = tbl[:tbl.find("<w:tr")]
    guk = int(ctx.get("guk_hours") or 0)
    items = [(GUK_LABEL, guk)] if guk > 0 else []
    new = rr[:1] + _simple_rows(rr[1], items)
    doc = doc[:s] + head + "".join(new) + "</w:tbl>" + doc[e:]

    # 7) §8 наряды: строка «По плану», колонка «Несение службы в суточном наряде»
    s, e, tbl = table_after(doc, "Другие виды деятельности")
    rr = rows_of(tbl)
    idx = next(i for i, r in enumerate(rr) if "По плану" in r)
    cc = cells_of(rr[idx])
    cc[3] = set_cell(cc[3], ctx.get("naryad_hours") or "")
    head = tbl[:tbl.find("<w:tr")]
    new = rr[:idx] + ["<w:tr>" + "".join(cc) + "</w:tr>"] + rr[idx + 1:]
    doc = doc[:s] + head + "".join(new) + "</w:tbl>" + doc[e:]

    # 8) §9 оперативки: вечные + разовые единым циклом (образец: {{ОП_ТЕМА}})
    ops = []
    for o in ctx.get("eternal_ops") or []:
        ops.append((o.get("name", ""), o.get("goal", ""), o.get("tasks", ""),
                    o.get("result", ""), "Ежемесячно", o.get("doc", ""),
                    o.get("hours", 0)))
    for o in ctx.get("operatives") or []:
        ops.append((o.get("name", ""), o.get("goal", ""), o.get("tasks", ""),
                    o.get("result", ""), "В течение месяца", o.get("doc", ""),
                    o.get("hours", 0)))

    def _op_rows(sample):
        sc = cells_of(sample)
        if not ops:
            c = sc[:]
            for i in range(8):
                c[i] = set_cell(c[i], "")
            return ["<w:tr>" + "".join(c) + "</w:tr>"]
        out = []
        for n, (name, goal, tasks, result, term, docum, hours) in enumerate(ops, 1):
            c = sc[:]
            c[0] = set_cell(c[0], "%d." % n)
            c[1] = set_cell(c[1], name, italic=True)
            c[2] = set_cell(c[2], goal)
            c[3] = set_cell(c[3], tasks)
            c[4] = set_cell(c[4], result)
            c[5] = set_cell(c[5], term)
            c[6] = set_cell(c[6], docum)
            c[7] = set_cell(c[7], hours)
            out.append("<w:tr>" + "".join(c) + "</w:tr>")
        return out

    doc = _replace_sample_rows(doc, "{{ОП_ТЕМА}}", _op_rows)

    # ── упаковка в память ────────────────────────────────────────────────────
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                data = doc.encode("utf-8")
            zout.writestr(item, data)
    zin.close()
    return buf.getvalue()
