from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
from pathlib import Path
from datetime import date
from html import escape
import re

from db import get_db, init_db
from parsers import parse_order_docx, parse_software_docx, parse_article_docx
from export import generate_report_xlsx
from software_doc import generate_software_docx

BASE = Path(__file__).parent
UPLOADS_DIR = BASE / "uploads"
REPORTS_DIR = BASE / "reports"
LOGS_DIR = BASE / "logs"
UPLOADS_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="ВАС Результативность")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup():
    init_db()


# ── AUTH HELPERS ──────────────────────────────────────────────────────────────

def _current_user(request: Request) -> dict:
    uid = request.cookies.get('vas_uid', '')
    if not uid or not uid.isdigit():
        raise HTTPException(401, "Не авторизован")
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (int(uid),)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(401, "Пользователь не найден")
    return dict(row)


def _require_supervisor(request: Request) -> dict:
    user = _current_user(request)
    if user['role'] != 'supervisor':
        raise HTTPException(403, "Недостаточно прав")
    return user


def _require(data: dict, *keys: str):
    missing = [k for k in keys if not data.get(k)]
    if missing:
        raise HTTPException(400, f"Не заполнены обязательные поля: {', '.join(missing)}")


def _safe_upload_path(filename: str) -> Path:
    path = (UPLOADS_DIR / filename).resolve()
    try:
        path.relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        raise HTTPException(404, "Файл не найден")
    return path


# ── SESSION ───────────────────────────────────────────────────────────────────

@app.get("/api/users/list")
def list_users_public():
    """Public: returns users for the login screen (dev mode — no passwords)."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, username, role, last_name, first_patronymic, position FROM users ORDER BY role DESC, last_name"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/me")
def get_me(request: Request):
    return _current_user(request)


@app.post("/api/session")
async def login(request: Request, response: Response):
    data = await request.json()
    uid = data.get('user_id')
    if not uid:
        raise HTTPException(400, "Укажите user_id")
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (int(uid),)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Пользователь не найден")
    response.set_cookie('vas_uid', str(row['id']), httponly=True, samesite='lax', max_age=86400 * 30)
    return {"ok": True, "user": dict(row)}


@app.delete("/api/session")
def logout(response: Response):
    response.delete_cookie('vas_uid')
    return {"ok": True}


# ── PROFILE (current user) ────────────────────────────────────────────────────

@app.get("/api/profile")
def get_profile(request: Request):
    return _current_user(request)


@app.put("/api/profile")
async def update_profile(request: Request):
    user = _current_user(request)
    data = await request.json()
    conn = get_db()
    conn.execute(
        "UPDATE users SET last_name=?, first_patronymic=?, position=?, unit=?, rank=? WHERE id=?",
        (data.get('last_name', ''), data.get('first_patronymic', ''),
         data.get('position', ''), data.get('unit', ''), data.get('rank', ''), user['id'])
    )
    conn.commit()
    conn.close()
    return {"ok": True}


# ── USER MANAGEMENT (supervisor only) ─────────────────────────────────────────

@app.get("/api/users")
def get_users(request: Request):
    _require_supervisor(request)
    conn = get_db()
    rows = conn.execute(
        "SELECT id, username, role, last_name, first_patronymic, position, rank, unit FROM users ORDER BY role DESC, last_name"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/users")
async def create_user(request: Request):
    _require_supervisor(request)
    data = await request.json()
    _require(data, 'username')
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, role, last_name, first_patronymic, position, rank, unit) VALUES (?,?,?,?,?,?,?)",
            (data['username'], data.get('role', 'employee'), data.get('last_name', ''),
             data.get('first_patronymic', ''), data.get('position', ''),
             data.get('rank', ''), data.get('unit', ''))
        )
        uid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(400, f"Ошибка: {e}")
    conn.close()
    return {"id": uid, "ok": True}


@app.put("/api/users/{uid}")
async def update_user(uid: int, request: Request):
    _require_supervisor(request)
    data = await request.json()
    conn = get_db()
    conn.execute(
        "UPDATE users SET username=?, role=?, last_name=?, first_patronymic=?, position=?, rank=?, unit=? WHERE id=?",
        (data.get('username', ''), data.get('role', 'employee'), data.get('last_name', ''),
         data.get('first_patronymic', ''), data.get('position', ''),
         data.get('rank', ''), data.get('unit', ''), uid)
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/users/{uid}")
def delete_user(uid: int, request: Request):
    sv = _require_supervisor(request)
    if uid == sv['id']:
        raise HTTPException(400, "Нельзя удалить собственный аккаунт")
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── ORDERS ────────────────────────────────────────────────────────────────────

def _order_expired(o: dict) -> bool:
    if o['deadline_type'] == 'date' and o['deadline_date']:
        return o['deadline_date'] < date.today().isoformat()
    return False


@app.get("/api/orders")
def get_orders(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = conn.execute("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", (user['id'],)).fetchall()
    conn.close()
    result = []
    for r in rows:
        o = dict(r)
        o['expired'] = _order_expired(o)
        result.append(o)
    return result


@app.get("/api/orders/active")
def get_active_orders(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM orders WHERE user_id=? AND is_active=1 ORDER BY number", (user['id'],)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows if not _order_expired(dict(r))]


@app.post("/api/orders")
async def create_order(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'number', 'title', 'level', 'deadline_type')
    conn = get_db()
    conn.execute(
        "INSERT INTO orders (user_id, number, title, level, deadline_type, deadline_date, order_date, executor) VALUES (?,?,?,?,?,?,?,?)",
        (user['id'], data['number'], data['title'], data['level'], data['deadline_type'],
         data.get('deadline_date'), data.get('order_date'), data.get('executor', ''))
    )
    conn.commit()
    oid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return {"id": oid, "ok": True}


@app.put("/api/orders/{order_id}")
async def update_order(order_id: int, request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'number', 'title', 'level', 'deadline_type')
    conn = get_db()
    conn.execute(
        "UPDATE orders SET number=?, title=?, level=?, deadline_type=?, deadline_date=?, order_date=?, is_active=?, executor=? WHERE id=? AND user_id=?",
        (data['number'], data['title'], data['level'], data['deadline_type'],
         data.get('deadline_date'), data.get('order_date'), data.get('is_active', 1),
         data.get('executor', ''), order_id, user['id'])
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/orders/{order_id}")
def delete_order(order_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    conn.execute("DELETE FROM orders WHERE id=? AND user_id=?", (order_id, user['id']))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/orders/parse")
async def parse_order_file(request: Request, file: UploadFile = File(...)):
    _current_user(request)
    suffix = Path(file.filename).suffix
    path = UPLOADS_DIR / f"order_parse_tmp{suffix}"
    path.write_bytes(await file.read())
    try:
        return parse_order_docx(str(path))
    except Exception as e:
        raise HTTPException(400, f"Ошибка парсинга: {e}")


# ── FILE UPLOADS ──────────────────────────────────────────────────────────────

@app.post("/api/upload/confirmation")
async def upload_confirmation(file: UploadFile = File(...), order_id: str = Form("")):
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename)
    filename = f"confirm_{order_id}_{safe_name}"
    (UPLOADS_DIR / filename).write_bytes(await file.read())
    return {"filename": filename}


@app.post("/api/upload/conference")
async def upload_conference(file: UploadFile = File(...)):
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename or 'certificate')
    filename = f"conf_{safe_name}"
    (UPLOADS_DIR / filename).write_bytes(await file.read())
    return {"filename": filename}


@app.get("/api/uploads/{filename}")
def serve_upload(filename: str):
    path = _safe_upload_path(filename)
    if not path.exists():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(str(path), filename=filename)


def _docx_to_html(path: Path) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P

    doc = Document(str(path))
    align_map = {1: 'center', 2: 'right', 3: 'justify'}
    parts = []
    for child in doc.element.body.iterchildren():
        if isinstance(child, CT_P):
            p = Paragraph(child, doc)
            txt = escape(p.text).replace('\n', '<br>')
            style = ''
            if p.alignment is not None:
                a = align_map.get(int(p.alignment))
                if a:
                    style = f' style="text-align:{a}"'
            parts.append(f'<p{style}>{txt or "&nbsp;"}</p>')
        elif isinstance(child, CT_Tbl):
            t = Table(child, doc)
            rows = []
            for row in t.rows:
                cells = []
                for cell in row.cells:
                    cell_html = '<br>'.join(escape(line) for line in cell.text.split('\n'))
                    cells.append(f'<td>{cell_html or "&nbsp;"}</td>')
                rows.append('<tr>' + ''.join(cells) + '</tr>')
            parts.append('<table>' + ''.join(rows) + '</table>')
    return '\n'.join(parts)


@app.get("/api/uploads/{filename}/preview")
def preview_upload(filename: str):
    path = _safe_upload_path(filename)
    if not path.exists():
        raise HTTPException(404, "Файл не найден")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return FileResponse(str(path), media_type="application/pdf")
    _img = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"}
    if suffix in _img:
        return FileResponse(str(path), media_type=_img[suffix])
    if suffix == ".docx":
        try:
            inner = _docx_to_html(path)
        except Exception as e:
            inner = f'<p style="color:#b91c1c">Не удалось отобразить: {escape(str(e))}</p>'
        html = (
            '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
            '<style>'
            "body{font-family:'Times New Roman',Georgia,serif;font-size:14px;color:#111;margin:24px;line-height:1.4}"
            'p{margin:4px 0}table{border-collapse:collapse;width:100%;margin:10px 0}'
            'td{border:1px solid #555;padding:4px 6px;vertical-align:top;font-size:12px}'
            '</style></head><body>' + inner + '</body></html>'
        )
        return HTMLResponse(html)
    return FileResponse(str(path), filename=filename)


# ── SOFTWARE ──────────────────────────────────────────────────────────────────

@app.get("/api/software")
def get_software(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = conn.execute("SELECT * FROM software WHERE user_id=? ORDER BY created_at DESC", (user['id'],)).fetchall()
    result = []
    for r in rows:
        s = dict(r)
        s['authors'] = [dict(a) for a in conn.execute(
            "SELECT * FROM software_authors WHERE software_id=?", (s['id'],)
        ).fetchall()]
        result.append(s)
    conn.close()
    return result


@app.post("/api/software/parse")
async def parse_software_file(request: Request, file: UploadFile = File(...)):
    _current_user(request)
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename)
    filename = f"sw_{safe_name}"
    path = UPLOADS_DIR / filename
    path.write_bytes(await file.read())
    try:
        results = parse_software_docx(str(path))
        if not results:
            raise HTTPException(400, "Не найдено ни одной программы в документе")
        for entry in results:
            entry['docx_filename'] = filename
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Ошибка парсинга: {e}")


@app.post("/api/software")
async def create_software(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'title', 'certificate_number')
    cert = data.get('certificate_number', '').strip()
    conn = get_db()
    existing = conn.execute(
        "SELECT id, is_used FROM software WHERE certificate_number=? AND user_id=?", (cert, user['id'])
    ).fetchone()
    if existing and existing['is_used']:
        conn.close()
        raise HTTPException(400, "Это свидетельство уже было подано в одном из отчётов")

    docx_filename = data.get('docx_filename')
    if not docx_filename:
        docx_bytes = generate_software_docx(data, user)
        safe_cert = re.sub(r'[^\w]', '_', cert)
        docx_filename = f"sw_manual_{safe_cert}.docx"
        (UPLOADS_DIR / docx_filename).write_bytes(docx_bytes)

    if existing:
        sw_id = existing['id']
        conn.execute(
            "UPDATE software SET title=?, registration_date=?, output_data=?, docx_filename=? WHERE id=?",
            (data['title'], data.get('registration_date'), data.get('output_data', ''), docx_filename, sw_id)
        )
    else:
        conn.execute(
            "INSERT INTO software (user_id, title, certificate_number, registration_date, output_data, docx_filename) VALUES (?,?,?,?,?,?)",
            (user['id'], data['title'], cert, data.get('registration_date'), data.get('output_data', ''), docx_filename)
        )
        sw_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute("DELETE FROM software_authors WHERE software_id=?", (sw_id,))
    for a in data.get('authors', []):
        conn.execute(
            "INSERT INTO software_authors (software_id, full_name, position, contribution_percent, points_claimed) VALUES (?,?,?,?,?)",
            (sw_id, a['full_name'], a.get('position', ''),
             a.get('contribution_percent', 0), a.get('points_claimed', 0))
        )
    conn.commit()
    conn.close()
    return {"id": sw_id, "ok": True, "docx_filename": docx_filename}


@app.get("/api/software/{sw_id}/docx")
def download_software_docx(sw_id: int, request: Request):
    _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM software WHERE id=?", (sw_id,)).fetchone()
    if not row:
        raise HTTPException(404, "ПО не найдено")
    sw = dict(row)
    sw['authors'] = [dict(a) for a in conn.execute(
        "SELECT * FROM software_authors WHERE software_id=?", (sw_id,)
    ).fetchall()]
    sw_user = conn.execute("SELECT * FROM users WHERE id=?", (sw['user_id'],)).fetchone()
    profile = dict(sw_user) if sw_user else {}
    conn.close()

    if sw.get('docx_filename'):
        path = UPLOADS_DIR / sw['docx_filename']
        if path.exists():
            return FileResponse(str(path), filename=sw['docx_filename'],
                                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    from fastapi.responses import Response as FR
    docx_bytes = generate_software_docx(sw, profile)
    return FR(content=docx_bytes,
              media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              headers={"Content-Disposition": f'attachment; filename="sw_{sw_id}.docx"'})


# ── ARTICLES ──────────────────────────────────────────────────────────────────

@app.get("/api/articles")
def get_articles(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = conn.execute("SELECT * FROM articles WHERE user_id=? ORDER BY created_at DESC", (user['id'],)).fetchall()
    result = []
    for r in rows:
        a = dict(r)
        a['author_list'] = [dict(au) for au in conn.execute(
            "SELECT full_name, points FROM article_authors WHERE article_id=? ORDER BY id", (a['id'],)
        ).fetchall()]
        result.append(a)
    conn.close()
    return result


@app.post("/api/articles/parse")
async def parse_article_file(request: Request, file: UploadFile = File(...)):
    _current_user(request)
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename)
    filename = f"art_{safe_name}"
    path = UPLOADS_DIR / filename
    path.write_bytes(await file.read())
    try:
        results = parse_article_docx(str(path))
        if not results:
            raise HTTPException(400, "Не найдено ни одной статьи в документе")
        for entry in results:
            entry['docx_filename'] = filename
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Ошибка парсинга: {e}")


@app.post("/api/parse/batch")
async def parse_batch(request: Request, files: list[UploadFile] = File(...)):
    _current_user(request)
    results = []
    for upload in files:
        safe = re.sub(r'[^\w.\-]', '_', upload.filename or 'file.docx')
        fname = f"batch_{safe}"
        path = UPLOADS_DIR / fname
        path.write_bytes(await upload.read())
        for entry in parse_software_docx(str(path)):
            entry['kind'] = 'software'
            entry['docx_filename'] = fname
            results.append(entry)
        for entry in parse_article_docx(str(path)):
            entry['kind'] = 'article'
            entry['article_type'] = 'rinc'
            entry['docx_filename'] = fname
            results.append(entry)
    return results


@app.post("/api/articles")
async def create_article(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'title', 'article_type')
    conn = get_db()
    conn.execute(
        "INSERT INTO articles (user_id, title, publication, authors, article_type, docx_filename) VALUES (?,?,?,?,?,?)",
        (user['id'], data['title'], data.get('publication', ''), data.get('authors', ''),
         data['article_type'], data.get('docx_filename', ''))
    )
    aid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    for a in data.get('author_list', []):
        conn.execute(
            "INSERT INTO article_authors (article_id, full_name, points) VALUES (?,?,?)",
            (aid, a['full_name'], a.get('points', 0))
        )
    conn.commit()
    conn.close()
    return {"id": aid, "ok": True}


@app.delete("/api/articles/{article_id}")
def delete_article(article_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    conn.execute("DELETE FROM articles WHERE id=? AND is_used=0 AND user_id=?", (article_id, user['id']))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── REPORTS ───────────────────────────────────────────────────────────────────

def _get_report_data(report_id: int) -> dict:
    """Internal: fetch full report without auth check."""
    conn = get_db()
    report = conn.execute("SELECT * FROM monthly_reports WHERE id=?", (report_id,)).fetchone()
    if not report:
        raise HTTPException(404, "Отчёт не найден")
    orders = conn.execute("""
        SELECT ro.confirmation_filename, o.id, o.number, o.title, o.level, o.deadline_type
        FROM report_orders ro JOIN orders o ON ro.order_id=o.id WHERE ro.report_id=?
    """, (report_id,)).fetchall()
    sw_list = conn.execute("""
        SELECT rs.points_taken, s.id, s.title, s.certificate_number, s.registration_date, s.docx_filename
        FROM report_software rs JOIN software s ON rs.software_id=s.id WHERE rs.report_id=?
    """, (report_id,)).fetchall()
    arts = conn.execute("""
        SELECT ra.points_taken, a.id, a.title, a.publication, a.article_type
        FROM report_articles ra JOIN articles a ON ra.article_id=a.id WHERE ra.report_id=?
    """, (report_id,)).fetchall()
    confs = conn.execute(
        "SELECT id, title, certificate_filename, points_taken FROM conferences WHERE report_id=?",
        (report_id,)
    ).fetchall()
    conn.close()
    return {
        **dict(report),
        "orders": [dict(o) for o in orders],
        "software": [dict(s) for s in sw_list],
        "articles": [dict(a) for a in arts],
        "conferences": [dict(c) for c in confs],
    }


@app.delete("/api/reports/all")
def clear_all_reports(request: Request):
    """Testing utility: clears current user's data."""
    user = _current_user(request)
    uid = user['id']
    conn = get_db()
    rows = conn.execute("SELECT xlsx_path FROM monthly_reports WHERE user_id=?", (uid,)).fetchall()
    for row in rows:
        p = Path(row['xlsx_path']) if row['xlsx_path'] else None
        if p and p.exists():
            p.unlink()
    conn.execute("DELETE FROM monthly_reports WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM software WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM articles WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM orders WHERE user_id=?", (uid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/reports")
def get_reports(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM monthly_reports WHERE user_id=? ORDER BY year DESC, month DESC", (user['id'],)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/reports/{report_id}")
def get_report(report_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT user_id FROM monthly_reports WHERE id=?", (report_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Отчёт не найден")
    if user['role'] != 'supervisor' and row['user_id'] != user['id']:
        raise HTTPException(403, "Доступ запрещён")
    return _get_report_data(report_id)


@app.post("/api/reports/submit")
async def submit_report(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'year', 'month')
    year = data['year']
    month = data['month']
    uid = user['id']

    conn = get_db()
    if conn.execute(
        "SELECT id FROM monthly_reports WHERE user_id=? AND year=? AND month=?", (uid, year, month)
    ).fetchone():
        conn.close()
        raise HTTPException(400, "Отчёт за этот месяц уже существует")

    sw_items = data.get('software', [])
    for sw in sw_items:
        row = conn.execute("SELECT is_used FROM software WHERE id=? AND user_id=?", (sw['id'], uid)).fetchone()
        if row and row['is_used']:
            conn.close()
            raise HTTPException(400, f"ПО «{sw.get('title', '')}» уже использовано в другом отчёте")

    articles_data = data.get('articles', [])
    for entry in articles_data:
        aid = entry['id'] if isinstance(entry, dict) else entry
        row = conn.execute("SELECT is_used, title FROM articles WHERE id=? AND user_id=?", (aid, uid)).fetchone()
        if row and row['is_used']:
            conn.close()
            raise HTTPException(400, f"Статья «{row['title']}» уже использована")

    conn.execute("INSERT INTO monthly_reports (user_id, year, month) VALUES (?,?,?)", (uid, year, month))
    report_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    order_ids = data.get('order_ids', [])
    confirmations = data.get('confirmations', {})
    for oid in order_ids:
        conn.execute(
            "INSERT INTO report_orders (report_id, order_id, confirmation_filename) VALUES (?,?,?)",
            (report_id, oid, confirmations.get(str(oid)))
        )

    for sw in sw_items:
        conn.execute(
            "INSERT INTO report_software (report_id, software_id, points_taken) VALUES (?,?,?)",
            (report_id, sw['id'], sw.get('points_claimed', 0))
        )
        conn.execute("UPDATE software SET is_used=1, used_month=?, used_year=? WHERE id=?", (month, year, sw['id']))

    for entry in articles_data:
        aid = entry['id'] if isinstance(entry, dict) else entry
        pts = entry.get('points_taken', 0) if isinstance(entry, dict) else 0
        conn.execute(
            "INSERT INTO report_articles (report_id, article_id, points_taken) VALUES (?,?,?)",
            (report_id, aid, pts)
        )
        conn.execute("UPDATE articles SET is_used=1, used_month=?, used_year=? WHERE id=?", (month, year, aid))

    for conf in data.get('conferences', []):
        conn.execute(
            "INSERT INTO conferences (report_id, title, certificate_filename, points_taken) VALUES (?,?,?,?)",
            (report_id, conf.get('title', ''), conf.get('certificate_filename', ''), conf.get('points_taken', 0))
        )

    conn.commit()
    conn.close()

    report_data = _get_report_data(report_id)

    from export import WEIGHTS
    total = 0.0
    for o in report_data['orders']:
        total += WEIGHTS['order_academy'] if o['level'] == 'academy' else WEIGHTS['order_higher']
    for s in report_data['software']:
        total += s['points_taken']
    for a in report_data['articles']:
        total += a.get('points_taken', 0)
    for c in report_data.get('conferences', []):
        total += c.get('points_taken', 0)

    xlsx_bytes = generate_report_xlsx(user, report_data)
    xlsx_path = REPORTS_DIR / f"report_{uid}_{year}_{month:02d}.xlsx"
    xlsx_path.write_bytes(xlsx_bytes)

    conn2 = get_db()
    conn2.execute("UPDATE monthly_reports SET xlsx_path=?, total_points=? WHERE id=?",
                  (str(xlsx_path), total, report_id))
    conn2.commit()
    conn2.close()

    return {"id": report_id, "total_points": total, "ok": True}


@app.get("/api/reports/{report_id}/export")
def export_report(report_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM monthly_reports WHERE id=?", (report_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Отчёт не найден")
    if user['role'] != 'supervisor' and row['user_id'] != user['id']:
        raise HTTPException(403, "Доступ запрещён")
    if not row['xlsx_path']:
        raise HTTPException(404, "Файл не найден")
    p = Path(row['xlsx_path'])
    if not p.exists():
        raise HTTPException(404, "Файл не найден на диске")
    return FileResponse(
        str(p),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"Результативность_{row['year']}_{row['month']:02d}.xlsx"
    )


# ── SUPERVISOR ────────────────────────────────────────────────────────────────

@app.get("/api/supervisor/employees")
def supervisor_employees(request: Request):
    _require_supervisor(request)
    conn = get_db()
    users = conn.execute(
        "SELECT id, username, role, last_name, first_patronymic, position, unit FROM users WHERE role='employee' ORDER BY last_name"
    ).fetchall()
    result = []
    for u in users:
        ud = dict(u)
        reports = conn.execute(
            "SELECT id, year, month, total_points, status FROM monthly_reports WHERE user_id=? ORDER BY year DESC, month DESC",
            (ud['id'],)
        ).fetchall()
        ud['reports'] = [dict(r) for r in reports]
        result.append(ud)
    conn.close()
    return result


@app.get("/api/supervisor/users/{uid}/reports")
def supervisor_user_reports(uid: int, request: Request):
    _require_supervisor(request)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM monthly_reports WHERE user_id=? ORDER BY year DESC, month DESC", (uid,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/supervisor/reports/{report_id}/approve")
async def approve_report(report_id: int, request: Request):
    _require_supervisor(request)
    data = await request.json()
    conn = get_db()
    conn.execute("UPDATE monthly_reports SET status='approved', supervisor_comment=? WHERE id=?",
                 (data.get('comment', ''), report_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/supervisor/reports/{report_id}/reject")
async def reject_report(report_id: int, request: Request):
    _require_supervisor(request)
    data = await request.json()
    conn = get_db()
    conn.execute("UPDATE monthly_reports SET status='rejected', supervisor_comment=? WHERE id=?",
                 (data.get('comment', ''), report_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/supervisor/reports/{report_id}")
def supervisor_delete_report(report_id: int, request: Request):
    _require_supervisor(request)
    conn = get_db()
    row = conn.execute("SELECT xlsx_path FROM monthly_reports WHERE id=?", (report_id,)).fetchone()
    if row and row['xlsx_path']:
        p = Path(row['xlsx_path'])
        if p.exists():
            p.unlink()
    conn.execute("DELETE FROM monthly_reports WHERE id=?", (report_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── STATIC ────────────────────────────────────────────────────────────────────

class NoCacheStaticFiles(StaticFiles):
    """Dev mode: never cache static assets so JS/CSS edits show up on a normal reload."""
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp


app.mount("/static", NoCacheStaticFiles(directory=str(BASE / "static")), name="static")


@app.get("/")
def root():
    return FileResponse(
        str(BASE / "static" / "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


if __name__ == "__main__":
    import webbrowser, threading

    log_config = {
        "version": 1, "disable_existing_loggers": False,
        "formatters": {"default": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
        "handlers": {
            "console": {"class": "logging.StreamHandler", "formatter": "default"},
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "filename": str(LOGS_DIR / "server.log"),
                "maxBytes": 2097152, "backupCount": 3, "encoding": "utf-8", "formatter": "default",
            },
        },
        "loggers": {
            "uvicorn":        {"handlers": ["console", "file"], "level": "INFO"},
            "uvicorn.error":  {"handlers": ["console", "file"], "level": "INFO"},
            "uvicorn.access": {"handlers": ["console", "file"], "level": "INFO", "propagate": False},
        },
    }

    port = int(os.environ.get("PORT", "8001"))

    if not os.environ.get("PORT"):
        def _open():
            import time; time.sleep(1); webbrowser.open(f"http://127.0.0.1:{port}")
        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False, log_config=log_config)
