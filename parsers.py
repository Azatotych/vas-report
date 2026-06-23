import re
from docx import Document


def _normalize(text: str) -> str:
    text = re.sub(r'(\d)\s*\.\s*(\d)', r'\1.\2', text)
    text = re.sub(r'№\s+', '№', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text


def parse_order_docx(file_path: str) -> dict:
    doc = Document(file_path)
    full_text = ' '.join(p.text for p in doc.paragraphs)
    full_text = _normalize(full_text)

    result = {
        'level': 'academy',
        'number': '',
        'title': '',
        'order_date': '',
        'deadline_type': 'monthly',
        'deadline_date': None,
        'workload_hours': None,
    }

    text_lower = full_text.lower()

    # Level detection
    if any(kw in text_lower for kw in ['вышестоящего органа', 'главного управления', 'министерства обороны']):
        result['level'] = 'higher'
    if any(kw in text_lower for kw in ['руководства академии', 'начальника вас', 'руководящего состава военной академии']):
        result['level'] = 'academy'

    # Order number + date
    m = re.search(r'(?:Приказани[ея]|Приказ)[^№]*№(\d+)[^\d]*от\s+([\d.]+)', full_text)
    if m:
        result['number'] = m.group(1)
        result['order_date'] = m.group(2)

    # Theme
    m = re.search(r'Тема\s*:\s*[«\"](.+?)[»\"]', full_text)
    if m:
        result['title'] = m.group(1).strip()

    # Deadline
    if 'ежемесячно' in text_lower:
        result['deadline_type'] = 'monthly'
    else:
        m = re.search(r'Дата выполнения\s*:\s*([\d.]+)', full_text)
        if m:
            result['deadline_type'] = 'date'
            result['deadline_date'] = m.group(1)

    # Workload
    m = re.search(r'Трудозатраты\s*:\s*(\d+)\s*час', full_text)
    if m:
        result['workload_hours'] = int(m.group(1))

    return result


def _cell_paragraphs(cell) -> list[str]:
    """Return non-empty lines from a cell.
    Handles both real paragraph breaks and soft line breaks (<w:br/>),
    since cell.text uses '\\n' for both.
    """
    lines = []
    for p in cell.paragraphs:
        for line in p.text.split('\n'):
            line = line.replace('\xa0', ' ').strip().rstrip(',').strip()
            if line:
                lines.append(line)
    return lines


def _parse_software_row(cells) -> dict:
    """Parse one data row from the software table."""
    entry = {
        'title': '',
        'certificate_number': '',
        'registration_date': '',
        'output_data': '',
        'authors': [],
    }

    entry['title'] = _normalize(cells[1].text.strip())

    output_text = _normalize(cells[2].text.strip())
    entry['output_data'] = output_text

    m = re.search(r'Номер свидетельства\s*:\s*(RU\s*\d+)', output_text, re.IGNORECASE)
    if m:
        entry['certificate_number'] = _normalize(m.group(1)).strip()
    else:
        # "Свидетельство о государственной регистрации ... № 2025612897"
        m2 = re.search(r'регистрации[^№]*№\s*(\d+)', output_text, re.IGNORECASE)
        if m2:
            entry['certificate_number'] = m2.group(1)

    m = re.search(r'Дата государственной регистрации[^:]*:\s*([\d.]+)', output_text, re.IGNORECASE)
    if m:
        entry['registration_date'] = m.group(1)
    else:
        # "опубл. 05.02.2025"
        m2 = re.search(r'опубл\.?\s*([\d]{2}\.[\d]{2}\.[\d]{4})', output_text, re.IGNORECASE)
        if m2:
            entry['registration_date'] = m2.group(1)

    fio_list = _cell_paragraphs(cells[3])
    pos_list = _cell_paragraphs(cells[4])

    pct_list = []
    for p in cells[5].paragraphs:
        full = ''.join(r.text for r in p.runs).strip() or p.text.strip()
        full = _normalize(full)
        m = re.search(r'(\d+)\s*%', full)
        if m:
            pct_list.append(int(m.group(1)))

    for i, fio in enumerate(fio_list):
        entry['authors'].append({
            'full_name': fio,
            'position': pos_list[i] if i < len(pos_list) else '',
            'contribution_percent': pct_list[i] if i < len(pct_list) else 0,
            'points_claimed': 0,
        })

    return entry


def _parse_article_row(cells) -> dict:
    """Parse one data row from the research-output table as an article entry."""
    entry = {'title': '', 'publication': '', 'authors': []}
    entry['title'] = _normalize(cells[1].text.strip())
    entry['publication'] = _normalize(cells[2].text.strip())

    fio_list = _cell_paragraphs(cells[3])
    pos_list = _cell_paragraphs(cells[4])

    pct_list = []
    for p in cells[5].paragraphs:
        full = ''.join(r.text for r in p.runs).strip() or p.text.strip()
        full = _normalize(full)
        m = re.search(r'(\d+)\s*%', full)
        if m:
            pct_list.append(int(m.group(1)))

    for i, fio in enumerate(fio_list):
        entry['authors'].append({
            'full_name': fio,
            'position': pos_list[i] if i < len(pos_list) else '',
            'contribution_percent': pct_list[i] if i < len(pct_list) else 0,
        })
    return entry


def parse_article_docx(file_path: str) -> list:
    """Returns article entries from a research-output dokkladnaya.
    Rows where the output column contains a software certificate are skipped.
    """
    doc = Document(file_path)
    if not doc.tables:
        return []

    results = []
    for row in doc.tables[0].rows[1:]:
        cells = row.cells
        if len(cells) < 6:
            continue
        title = cells[1].text.strip()
        if not title:
            continue
        output = cells[2].text.strip()
        if re.search(r'свидетельство.*регистрации', output, re.IGNORECASE):
            continue  # ПО entry — belongs to software parser
        results.append(_parse_article_row(cells))
    return results


def parse_software_docx(file_path: str) -> list:
    """Returns a list of software entries (one per table data row).
    Rows without a software certificate in the output column are skipped.
    """
    doc = Document(file_path)
    if not doc.tables:
        return []

    results = []
    for row in doc.tables[0].rows[1:]:
        cells = row.cells
        if len(cells) < 6:
            continue
        title = cells[1].text.strip()
        if not title:
            continue
        output = cells[2].text.strip()
        if not re.search(r'свидетельство.*регистрации', output, re.IGNORECASE):
            continue  # article entry — skip
        results.append(_parse_software_row(cells))

    return results
