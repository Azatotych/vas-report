from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import json
from pathlib import Path
from datetime import date, datetime
from html import escape
import re

from db import get_db, init_db
from auth import (
    SESSION_COOKIE,
    audit_event,
    authenticate,
    authenticated_user,
    cleanup_sessions,
    clear_session_cookie,
    create_session,
    generate_temporary_password,
    hash_password,
    iso_utc,
    normalize_username,
    public_user,
    revoke_session_token,
    revoke_user_sessions,
    set_session_cookie,
    validate_password,
    validate_username,
    verify_password,
)
from parsers import (
    certificate_key,
    normalize_certificate_number,
    parse_article_docx,
    parse_order_docx,
    parse_software_certificate_pdf,
    parse_software_docx,
)
from export import generate_report_xlsx
from software_doc import generate_software_batch_docx, generate_software_docx
import plan_calc
from plan_doc import generate_plan_docx, MONTHS_RU

APP_VERSION = "3.1.1"   # ручное распределение вкладов при пакетном импорте ПО

BASE = Path(__file__).parent
UPLOADS_DIR = BASE / "uploads"
REPORTS_DIR = BASE / "reports"
LOGS_DIR = BASE / "logs"
UPLOADS_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)
MAX_UPLOAD_BYTES = max(1, int(os.environ.get("VAS_MAX_UPLOAD_MB", "20"))) * 1024 * 1024
MAX_SOFTWARE_BATCH_FILES = 50
MAX_SOFTWARE_BATCH_BYTES = 100 * 1024 * 1024
DOCUMENT_UPLOAD_SUFFIXES = {".docx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"}

app = FastAPI(title="ВАС Результативность")
cors_origins = [x.strip() for x in os.environ.get("VAS_CORS_ORIGINS", "").split(",") if x.strip()]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    # SAMEORIGIN, не DENY: предпросмотр документов рендерится в same-origin iframe
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.on_event("startup")
def startup():
    init_db()
    cleanup_sessions()


@app.get("/api/version")
def get_version():
    return {"version": APP_VERSION}


# ── AUTH HELPERS ──────────────────────────────────────────────────────────────

def _current_user(request: Request) -> dict:
    return authenticated_user(request)


def _require_supervisor(request: Request) -> dict:
    user = _current_user(request)
    if user['role'] not in ('supervisor', 'admin'):
        raise HTTPException(403, "Недостаточно прав")
    return user


def _require_admin(request: Request) -> dict:
    user = _current_user(request)
    if user['role'] != 'admin':
        raise HTTPException(403, "Требуются права администратора")
    return user


def _can_manage_user(actor: dict, target: dict):
    if actor['role'] == 'admin':
        return
    if actor['role'] != 'supervisor' or target.get('role') != 'employee':
        raise HTTPException(403, "Недостаточно прав для управления этой учётной записью")


def _require(data: dict, *keys: str):
    missing = [k for k in keys if not data.get(k)]
    if missing:
        raise HTTPException(400, f"Не заполнены обязательные поля: {', '.join(missing)}")


def _current_period() -> tuple:
    """Текущий отчётный период (год, месяц) по системной дате."""
    now = datetime.now()
    return now.year, now.month


def _is_current_period(year: int, month: int) -> bool:
    cy, cm = _current_period()
    return int(year) == cy and int(month) == cm


def _delete_upload(filename: str):
    """Тихо удалить файл из uploads/ (для чистки осиротевших вложений)."""
    if not filename:
        return
    try:
        p = (UPLOADS_DIR / filename).resolve()
        if p.parent == UPLOADS_DIR.resolve() and p.exists():
            p.unlink()
    except Exception:
        pass


def _delete_upload_if_unreferenced(filename: str):
    """Delete a document only when no database row still points to it."""
    if not filename:
        return
    conn = get_db()
    referenced = conn.execute(
        """
        SELECT 1 FROM software WHERE docx_filename=?
        UNION ALL
        SELECT 1 FROM articles WHERE docx_filename=?
        UNION ALL
        SELECT 1 FROM report_orders WHERE confirmation_filename=?
        UNION ALL
        SELECT 1 FROM conferences WHERE certificate_filename=?
        LIMIT 1
        """,
        (filename, filename, filename, filename),
    ).fetchone()
    conn.close()
    if not referenced:
        _delete_upload(filename)


def _safe_upload_path(filename: str) -> Path:
    path = (UPLOADS_DIR / filename).resolve()
    try:
        path.relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        raise HTTPException(404, "Файл не найден")
    return path


async def _read_upload(file: UploadFile, allowed_suffixes: set[str]) -> bytes:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed_suffixes:
        raise HTTPException(400, f"Недопустимый тип файла: {suffix or 'без расширения'}")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413, f"Файл слишком большой. Максимум {MAX_UPLOAD_BYTES // 1024 // 1024} МБ"
        )
    return content


def _authorize_upload(filename: str, user: dict):
    if user['role'] in ('supervisor', 'admin'):
        return
    uid = user['id']
    own_prefixes = (
        f"confirm_{uid}_", f"conf_{uid}_", f"sw_{uid}_", f"art_{uid}_",
        f"sw_manual_{uid}_",
    )
    if filename.startswith(own_prefixes):
        return
    conn = get_db()
    owned = conn.execute(
        """
        SELECT 1 FROM software WHERE user_id=? AND docx_filename=?
        UNION ALL
        SELECT 1 FROM articles WHERE user_id=? AND docx_filename=?
        UNION ALL
        SELECT 1 FROM report_orders ro
          JOIN monthly_reports mr ON mr.id=ro.report_id
          WHERE mr.user_id=? AND ro.confirmation_filename=?
        UNION ALL
        SELECT 1 FROM conferences c
          JOIN monthly_reports mr ON mr.id=c.report_id
          WHERE mr.user_id=? AND c.certificate_filename=?
        LIMIT 1
        """,
        (uid, filename, uid, filename, uid, filename, uid, filename),
    ).fetchone()
    conn.close()
    if not owned:
        raise HTTPException(404, "Файл не найден")


# ── SESSION AND ACCOUNT SECURITY ──────────────────────────────────────────────


@app.get("/api/me")
def get_me(request: Request):
    return public_user(_current_user(request))


@app.post("/api/session")
async def login(request: Request, response: Response):
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(400, "Некорректный запрос")
    username = normalize_username(data.get('username', ''))
    password = data.get('password', '')
    if not username or not password:
        raise HTTPException(400, "Введите логин и пароль")
    user = authenticate(username, password, request)
    token = create_session(user['id'], request)
    set_session_cookie(response, token)
    cleanup_sessions()   # уборка протухших сессий: вход — редкое событие, запрос дешёвый
    return {"ok": True, "user": public_user(user)}


@app.delete("/api/session")
def logout(request: Request, response: Response):
    revoke_session_token(request.cookies.get(SESSION_COOKIE, ''), request)
    clear_session_cookie(response)
    return {"ok": True}


@app.post("/api/account/password")
async def change_password(request: Request):
    user = _current_user(request)
    data = await request.json()
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    conn = get_db()
    row = conn.execute(
        "SELECT password_hash, username FROM users WHERE id=?", (user['id'],)
    ).fetchone()
    if not row or not verify_password(current_password, row['password_hash']):
        audit_event(conn, "password_change_failed", request, user_id=user['id'])
        conn.commit()
        conn.close()
        raise HTTPException(400, "Текущий пароль указан неверно")
    error = validate_password(new_password, row['username'])
    if error:
        conn.close()
        raise HTTPException(400, error)
    if verify_password(new_password, row['password_hash']):
        conn.close()
        raise HTTPException(400, "Новый пароль должен отличаться от текущего")
    conn.execute(
        "UPDATE users SET password_hash=?, must_change_password=0, "
        "password_changed_at=?, failed_login_attempts=0, locked_until=NULL WHERE id=?",
        (hash_password(new_password), iso_utc(), user['id']),
    )
    revoke_user_sessions(conn, user['id'], user.get('_session_id'))
    audit_event(conn, "password_changed", request, user_id=user['id'])
    conn.commit()
    updated = conn.execute("SELECT * FROM users WHERE id=?", (user['id'],)).fetchone()
    conn.close()
    return {"ok": True, "user": public_user(dict(updated))}


@app.get("/api/account/sessions")
def list_own_sessions(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = conn.execute(
        "SELECT id, created_at, last_seen_at, expires_at, ip_address, user_agent "
        "FROM user_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? "
        "ORDER BY last_seen_at DESC",
        (user['id'], iso_utc()),
    ).fetchall()
    conn.close()
    return [
        {**dict(row), "current": row["id"] == user.get("_session_id")}
        for row in rows
    ]


@app.delete("/api/account/sessions/{session_id}")
def revoke_own_session(session_id: int, request: Request, response: Response):
    user = _current_user(request)
    conn = get_db()
    row = conn.execute(
        "SELECT id FROM user_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL",
        (session_id, user['id']),
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Сессия не найдена")
    conn.execute("UPDATE user_sessions SET revoked_at=? WHERE id=?", (iso_utc(), session_id))
    audit_event(
        conn, "session_revoked", request, user_id=user['id'],
        target_type="session", target_id=session_id,
    )
    conn.commit()
    conn.close()
    current = session_id == user.get("_session_id")
    if current:
        clear_session_cookie(response)
    return {"ok": True, "current": current}


# ── PROFILE (current user) ────────────────────────────────────────────────────

@app.get("/api/profile")
def get_profile(request: Request):
    return public_user(_current_user(request))


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


# ── USER MANAGEMENT ───────────────────────────────────────────────────────────

@app.get("/api/users")
def get_users(request: Request):
    actor = _require_supervisor(request)
    conn = get_db()
    if actor['role'] == 'admin':
        rows = conn.execute(
            "SELECT id, username, role, last_name, first_patronymic, position, rank, "
            "unit, active, must_change_password, last_login_at, locked_until "
            "FROM users ORDER BY active DESC, role DESC, last_name"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, username, role, last_name, first_patronymic, position, rank, "
            "unit, active, must_change_password, last_login_at, locked_until "
            "FROM users WHERE role='employee' ORDER BY active DESC, last_name"
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/users")
async def create_user(request: Request):
    actor = _require_supervisor(request)
    data = await request.json()
    _require(data, 'username')
    username = normalize_username(data['username'])
    error = validate_username(username)
    if error:
        raise HTTPException(400, error)
    role = data.get('role', 'employee')
    if role not in ('employee', 'supervisor', 'admin'):
        raise HTTPException(400, "Неизвестная роль")
    if actor['role'] != 'admin' and role != 'employee':
        raise HTTPException(403, "Начальник может создавать только аккаунты сотрудников")
    temporary_password = data.get('password') or generate_temporary_password()
    error = validate_password(temporary_password, username)
    if error:
        raise HTTPException(400, error)
    conn = get_db()
    if conn.execute("SELECT id FROM users WHERE lower(username)=?", (username,)).fetchone():
        conn.close()
        raise HTTPException(400, "Этот логин уже используется")
    try:
        conn.execute(
            "INSERT INTO users "
            "(username, role, last_name, first_patronymic, position, rank, unit, "
            "active, password_hash, must_change_password) VALUES (?,?,?,?,?,?,?,1,?,1)",
            (username, role, data.get('last_name', ''),
             data.get('first_patronymic', ''), data.get('position', ''),
             data.get('rank', ''), data.get('unit', ''), hash_password(temporary_password))
        )
        uid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        audit_event(
            conn, "user_created", request, user_id=actor['id'],
            target_type="user", target_id=uid,
            details={"username": username, "role": role},
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(400, f"Ошибка: {e}")
    conn.close()
    return {"id": uid, "ok": True, "temporary_password": temporary_password}


@app.put("/api/users/{uid}")
async def update_user(uid: int, request: Request):
    actor = _require_supervisor(request)
    data = await request.json()
    conn = get_db()
    target_row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target_row:
        conn.close()
        raise HTTPException(404, "Пользователь не найден")
    target = dict(target_row)
    _can_manage_user(actor, target)
    username = normalize_username(data.get('username', target['username']))
    error = validate_username(username)
    if error:
        conn.close()
        raise HTTPException(400, error)
    duplicate = conn.execute(
        "SELECT id FROM users WHERE lower(username)=? AND id<>?", (username, uid)
    ).fetchone()
    if duplicate:
        conn.close()
        raise HTTPException(400, "Этот логин уже используется")
    role = data.get('role', target['role'])
    if role not in ('employee', 'supervisor', 'admin'):
        conn.close()
        raise HTTPException(400, "Неизвестная роль")
    if actor['role'] != 'admin':
        role = 'employee'
    if uid == actor['id'] and role != actor['role']:
        conn.close()
        raise HTTPException(400, "Нельзя изменить собственную роль")
    active = 1 if data.get('active', target.get('active', 1)) else 0
    if uid == actor['id'] and not active:
        conn.close()
        raise HTTPException(400, "Нельзя отключить собственный аккаунт")
    conn.execute(
        "UPDATE users SET username=?, role=?, last_name=?, first_patronymic=?, "
        "position=?, rank=?, unit=?, active=? WHERE id=?",
        (username, role, data.get('last_name', ''),
         data.get('first_patronymic', ''), data.get('position', ''),
         data.get('rank', ''), data.get('unit', ''), active, uid)
    )
    if not active:
        revoke_user_sessions(conn, uid)
    audit_event(
        conn, "user_updated", request, user_id=actor['id'],
        target_type="user", target_id=uid,
        details={"username": username, "role": role, "active": bool(active)},
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/users/{uid}")
def delete_user(uid: int, request: Request):
    actor = _require_supervisor(request)
    if uid == actor['id']:
        raise HTTPException(400, "Нельзя удалить собственный аккаунт")
    # Мягкое удаление: аккаунт уходит из логина и списков, но его отчёты/РИД
    # остаются в общем архиве с привязкой к ФИО (целостность учёта).
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Пользователь не найден")
    _can_manage_user(actor, dict(row))
    conn.execute("UPDATE users SET active=0 WHERE id=?", (uid,))
    revoke_user_sessions(conn, uid)
    audit_event(
        conn, "user_disabled", request, user_id=actor['id'],
        target_type="user", target_id=uid,
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/users/{uid}/reset-password")
async def reset_user_password(uid: int, request: Request):
    actor = _require_supervisor(request)
    data = await request.json()
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Пользователь не найден")
    target = dict(row)
    _can_manage_user(actor, target)
    temporary_password = data.get('password') or generate_temporary_password()
    error = validate_password(temporary_password, target['username'])
    if error:
        conn.close()
        raise HTTPException(400, error)
    conn.execute(
        "UPDATE users SET password_hash=?, must_change_password=1, active=1, "
        "failed_login_attempts=0, locked_until=NULL, password_changed_at=? WHERE id=?",
        (hash_password(temporary_password), iso_utc(), uid),
    )
    revoke_user_sessions(conn, uid)
    audit_event(
        conn, "password_reset", request, user_id=actor['id'],
        target_type="user", target_id=uid,
    )
    conn.commit()
    conn.close()
    return {"ok": True, "temporary_password": temporary_password}


@app.post("/api/users/{uid}/unlock")
def unlock_user(uid: int, request: Request):
    actor = _require_supervisor(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Пользователь не найден")
    _can_manage_user(actor, dict(row))
    conn.execute(
        "UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=?", (uid,)
    )
    audit_event(
        conn, "user_unlocked", request, user_id=actor['id'],
        target_type="user", target_id=uid,
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/audit")
def get_audit(request: Request, limit: int = 100):
    _require_admin(request)
    limit = min(500, max(1, limit))
    conn = get_db()
    rows = conn.execute(
        "SELECT ae.*, u.username FROM audit_events ae "
        "LEFT JOIN users u ON u.id=ae.user_id ORDER BY ae.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    result = []
    for row in rows:
        item = dict(row)
        try:
            item['details'] = json.loads(item.get('details') or '{}')
        except json.JSONDecodeError:
            item['details'] = {}
        result.append(item)
    return result


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


@app.delete("/api/orders/all")
def clear_all_orders(request: Request):
    """Очистить реестр приказов текущего сотрудника. Сначала снимаем ссылки из
    сданных отчётов (report_orders), затем удаляем сами приказы.

    TEST-ONLY: массовая очистка нужна только на этапе тестирования. Удаляет
    приказы в т.ч. из уже утверждённых отчётов. УДАЛИТЬ ПЕРЕД ПРОДАКШЕНОМ
    (эндпоинт + кнопка clearOrders в static/js/reports.js + index.html)."""
    user = _current_user(request)
    uid = user['id']
    conn = get_db()
    conn.execute(
        "DELETE FROM report_orders WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)",
        (uid,))
    conn.execute("DELETE FROM orders WHERE user_id=?", (uid,))
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
    user = _current_user(request)
    content = await _read_upload(file, {".docx"})
    path = UPLOADS_DIR / f"order_parse_{user['id']}_{int(datetime.now().timestamp()*1000)}.docx"
    path.write_bytes(content)
    try:
        return parse_order_docx(str(path))
    except Exception as e:
        raise HTTPException(400, f"Ошибка парсинга: {e}")
    finally:
        path.unlink(missing_ok=True)


# ── FILE UPLOADS ──────────────────────────────────────────────────────────────

@app.post("/api/upload/confirmation")
async def upload_confirmation(request: Request, file: UploadFile = File(...), order_id: str = Form("")):
    user = _current_user(request)
    content = await _read_upload(file, DOCUMENT_UPLOAD_SUFFIXES)
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename or 'file')
    # уникальный префикс (пользователь + время), чтобы файлы не перетирали друг друга
    filename = f"confirm_{user['id']}_{order_id}_{int(datetime.now().timestamp()*1000)}_{safe_name}"
    (UPLOADS_DIR / filename).write_bytes(content)
    return {"filename": filename}


@app.post("/api/upload/conference")
async def upload_conference(request: Request, file: UploadFile = File(...)):
    user = _current_user(request)
    content = await _read_upload(file, DOCUMENT_UPLOAD_SUFFIXES)
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename or 'certificate')
    filename = f"conf_{user['id']}_{int(datetime.now().timestamp()*1000)}_{safe_name}"
    (UPLOADS_DIR / filename).write_bytes(content)
    return {"filename": filename}


@app.get("/api/uploads/{filename}")
def serve_upload(filename: str, request: Request):
    user = _current_user(request)
    _authorize_upload(filename, user)
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
def preview_upload(filename: str, request: Request):
    user = _current_user(request)
    _authorize_upload(filename, user)
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


def _find_user_software_by_certificate(conn, user_id: int, certificate: str):
    """Find legacy and normalized spellings of the same certificate number."""
    wanted_key = certificate_key(certificate)
    if not wanted_key:
        return None
    rows = conn.execute(
        "SELECT id, is_used, certificate_number, docx_filename "
        "FROM software WHERE user_id=?",
        (user_id,),
    ).fetchall()
    return next(
        (row for row in rows if certificate_key(row['certificate_number']) == wanted_key),
        None,
    )


def _validate_software_docx(conn, filename: str | None, user_id: int) -> str | None:
    """Accept parser uploads or documents already owned by this employee."""
    if not filename:
        return None
    if Path(filename).name != filename or Path(filename).suffix.lower() != '.docx':
        raise HTTPException(400, "Некорректный файл докладной записки")

    already_owned = conn.execute(
        "SELECT 1 FROM software WHERE user_id=? AND docx_filename=? LIMIT 1",
        (user_id, filename),
    ).fetchone()
    if already_owned:
        return filename

    if not filename.startswith(f"sw_{user_id}_"):
        raise HTTPException(400, "Файл докладной записки не принадлежит пользователю")
    if not _safe_upload_path(filename).exists():
        raise HTTPException(400, "Файл докладной записки не найден")
    return filename


def _decorate_software_status(entry: dict, conn, user_id: int):
    entry['already_used'] = False
    entry['in_bank'] = False
    entry['existing_id'] = None
    certificate = (entry.get('certificate_number') or '').strip()
    if not certificate:
        return
    row = _find_user_software_by_certificate(conn, user_id, certificate)
    if not row:
        return
    entry['existing_id'] = row['id']
    if row['is_used']:
        entry['already_used'] = True
    else:
        entry['in_bank'] = True


def _fill_profile_position(entry: dict, user: dict):
    last_name = (user.get('last_name') or '').lower().strip()
    if not last_name:
        return
    position = ' '.join(
        part.strip() for part in (user.get('position') or '', user.get('unit') or '')
        if part and part.strip()
    )
    for author in entry.get('authors', []):
        tokens = re.split(r'[\s.,]+', (author.get('full_name') or '').lower())
        if last_name in tokens and not author.get('position'):
            author['position'] = position

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


@app.delete("/api/software/all")
def clear_all_software(request: Request):
    """Очистить базу ПО текущего сотрудника — все карточки, включая поданные.
    Сначала снимаем ссылки из сданных отчётов (report_software), затем удаляем
    ПО (авторы удаляются каскадом) и связанные .docx-файлы. Статьи не трогаем.

    TEST-ONLY: массовая очистка нужна только на этапе тестирования. Удаляет ПО
    в т.ч. из уже утверждённых отчётов. УДАЛИТЬ ПЕРЕД ПРОДАКШЕНОМ
    (эндпоинт + кнопка clearSoftware в static/js/deposits.js + index.html)."""
    user = _current_user(request)
    uid = user['id']
    conn = get_db()
    files = conn.execute("SELECT docx_filename FROM software WHERE user_id=?", (uid,)).fetchall()
    conn.execute(
        "DELETE FROM report_software WHERE software_id IN (SELECT id FROM software WHERE user_id=?)",
        (uid,))
    conn.execute("DELETE FROM software WHERE user_id=?", (uid,))
    conn.commit()
    conn.close()
    for filename in {f['docx_filename'] for f in files if f['docx_filename']}:
        _delete_upload_if_unreferenced(filename)
    return {"ok": True}


@app.delete("/api/software/{sw_id}")
def delete_software(sw_id: int, request: Request):
    """Удаление ПО из картотеки — только если ещё не подано (is_used=0)."""
    user = _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT docx_filename FROM software WHERE id=? AND is_used=0 AND user_id=?", (sw_id, user['id'])).fetchone()
    conn.execute("DELETE FROM software WHERE id=? AND is_used=0 AND user_id=?", (sw_id, user['id']))
    conn.commit()
    conn.close()
    if row:
        _delete_upload_if_unreferenced(row['docx_filename'])
    return {"ok": True}


@app.post("/api/software/parse")
async def parse_software_file(request: Request, file: UploadFile = File(...)):
    user = _current_user(request)
    content = await _read_upload(file, {".docx"})
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename)
    filename = f"sw_{user['id']}_{int(datetime.now().timestamp()*1000)}_{safe_name}"
    path = UPLOADS_DIR / filename
    path.write_bytes(content)
    try:
        results = parse_software_docx(str(path))
        if not results:
            raise HTTPException(400, "Не найдено ни одной программы в документе")
        conn = get_db()
        for entry in results:
            entry['docx_filename'] = filename
            entry['source_filename'] = file.filename
            entry['source_type'] = 'docx'
            _decorate_software_status(entry, conn, user['id'])
        conn.close()
        return results
    except HTTPException:
        _delete_upload(filename)
        raise
    except Exception as e:
        _delete_upload(filename)
        raise HTTPException(400, f"Ошибка парсинга: {e}")


@app.post("/api/software/parse-batch")
async def parse_software_batch(request: Request, files: list[UploadFile] = File(...)):
    """Parse up to 50 PDF certificates and DOCX memos in one request."""
    user = _current_user(request)
    if not files:
        raise HTTPException(400, "Не выбрано ни одного файла")
    if len(files) > MAX_SOFTWARE_BATCH_FILES:
        raise HTTPException(400, f"За один раз можно загрузить не более {MAX_SOFTWARE_BATCH_FILES} файлов")

    entries = []
    errors = []
    stored_docx = set()
    total_bytes = 0
    seen_certificates = set()

    for index, upload in enumerate(files):
        stored_filename = None
        try:
            suffix = Path(upload.filename or '').suffix.lower()
            content = await _read_upload(upload, {'.docx', '.pdf'})
            total_bytes += len(content)
            if total_bytes > MAX_SOFTWARE_BATCH_BYTES:
                raise HTTPException(413, "Суммарный размер пакета превышает 100 МБ")

            if suffix == '.pdf':
                parsed_entries = [parse_software_certificate_pdf(content)]
                for entry in parsed_entries:
                    _fill_profile_position(entry, user)
            else:
                safe_name = re.sub(r'[^\w.\-]', '_', upload.filename or 'document.docx')
                stored_filename = (
                    f"sw_{user['id']}_{int(datetime.now().timestamp()*1000)}_"
                    f"{index}_{safe_name}"
                )
                (UPLOADS_DIR / stored_filename).write_bytes(content)
                stored_docx.add(stored_filename)
                parsed_entries = parse_software_docx(str(UPLOADS_DIR / stored_filename))
                if not parsed_entries:
                    raise ValueError('Не найдено ни одной программы в документе')

            for entry in parsed_entries:
                cert_key = certificate_key(entry.get('certificate_number', ''))
                if cert_key and cert_key in seen_certificates:
                    errors.append({
                        'filename': upload.filename or '',
                        'detail': f"Свидетельство {entry.get('certificate_number', '')} повторяется в пакете",
                    })
                    continue
                if cert_key:
                    seen_certificates.add(cert_key)
                entry['docx_filename'] = stored_filename
                entry['source_filename'] = upload.filename or ''
                entry['source_type'] = suffix.lstrip('.')
                entries.append(entry)
        except HTTPException as exc:
            if stored_filename:
                stored_docx.discard(stored_filename)
                _delete_upload(stored_filename)
            if exc.status_code == 413:
                for filename in stored_docx:
                    _delete_upload(filename)
                raise
            errors.append({'filename': upload.filename or '', 'detail': str(exc.detail)})
        except Exception as exc:
            if stored_filename:
                stored_docx.discard(stored_filename)
                _delete_upload(stored_filename)
            errors.append({'filename': upload.filename or '', 'detail': str(exc)})

    used_docx = {
        entry['docx_filename'] for entry in entries if entry.get('docx_filename')
    }
    for filename in stored_docx - used_docx:
        _delete_upload(filename)

    conn = get_db()
    for entry in entries:
        _decorate_software_status(entry, conn, user['id'])
    conn.close()

    if not entries:
        detail = '; '.join(
            f"{error['filename']}: {error['detail']}" for error in errors
        ) or 'Не найдено ни одной программы'
        raise HTTPException(400, detail)
    return {'entries': entries, 'errors': errors}


def _validated_software_batch_entry(raw: dict) -> dict:
    """Normalize one manually reviewed entry before an atomic batch save."""
    if not isinstance(raw, dict):
        raise HTTPException(400, "Некорректная запись ПО")
    title = str(raw.get('title') or '').strip()
    certificate = normalize_certificate_number(raw.get('certificate_number', ''))
    if not title or not certificate:
        raise HTTPException(400, "Для каждой программы нужны название и номер свидетельства")

    source_authors = raw.get('authors')
    if not isinstance(source_authors, list) or not source_authors:
        raise HTTPException(400, f"Для {certificate} не указаны авторы")
    authors = []
    total_percent = 0
    for author in source_authors:
        if not isinstance(author, dict):
            raise HTTPException(400, f"Некорректный автор в {certificate}")
        full_name = str(author.get('full_name') or '').strip()
        if not full_name:
            raise HTTPException(400, f"В {certificate} есть автор без ФИО")
        try:
            numeric_percent = float(author.get('contribution_percent', 0))
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, f"Некорректный вклад автора в {certificate}") from exc
        percent = int(numeric_percent)
        if numeric_percent != percent or not 0 <= percent <= 100:
            raise HTTPException(400, f"Вклад каждого автора в {certificate} должен быть целым числом от 0 до 100")
        total_percent += percent
        authors.append({
            'full_name': full_name,
            'position': str(author.get('position') or '').strip(),
            'contribution_percent': percent,
            'points_claimed': round(percent / 100 * 5, 2),
        })
    if total_percent != 100:
        raise HTTPException(400, f"Сумма вкладов авторов в {certificate} должна быть ровно 100%")

    return {
        'title': title,
        'certificate_number': certificate,
        'registration_date': str(raw.get('registration_date') or '').strip(),
        'output_data': str(raw.get('output_data') or '').strip(),
        'authors': authors,
    }


@app.post("/api/software/register-batch")
async def register_software_batch(request: Request):
    """Save manually reviewed programs together with one up-to-date memo."""
    user = _current_user(request)
    payload = await request.json()
    raw_entries = payload.get('entries') if isinstance(payload, dict) else None
    if not isinstance(raw_entries, list) or not raw_entries:
        raise HTTPException(400, "Нет подготовленных программ для регистрации")
    if len(raw_entries) > MAX_SOFTWARE_BATCH_FILES:
        raise HTTPException(400, f"За один раз можно зарегистрировать не более {MAX_SOFTWARE_BATCH_FILES} программ")

    entries = [_validated_software_batch_entry(raw) for raw in raw_entries]
    certificate_keys = [certificate_key(entry['certificate_number']) for entry in entries]
    if len(set(certificate_keys)) != len(certificate_keys):
        raise HTTPException(400, "В пакете повторяется номер свидетельства")

    conn = get_db()
    writable = []
    skipped = []
    for entry in entries:
        existing = _find_user_software_by_certificate(
            conn, user['id'], entry['certificate_number']
        )
        if existing and existing['is_used']:
            skipped.append({
                'certificate_number': entry['certificate_number'],
                'id': existing['id'],
                'already_used': True,
            })
        else:
            writable.append((entry, existing))

    if not writable:
        conn.close()
        return {
            'ok': True,
            'registered_count': 0,
            'results': skipped,
            'docx_filename': None,
        }

    memo_entries = [entry for entry, _ in writable]
    batch_filename = (
        f"sw_{user['id']}_{int(datetime.now().timestamp()*1000)}_pdf_batch.docx"
    )
    batch_path = UPLOADS_DIR / batch_filename
    old_docx_filenames = set()
    results = []
    try:
        batch_path.write_bytes(generate_software_batch_docx(memo_entries, user))
        for entry, existing in writable:
            if existing:
                sw_id = existing['id']
                if existing['docx_filename']:
                    old_docx_filenames.add(existing['docx_filename'])
                conn.execute(
                    "UPDATE software SET title=?, certificate_number=?, registration_date=?, "
                    "output_data=?, docx_filename=? WHERE id=?",
                    (
                        entry['title'], entry['certificate_number'],
                        entry.get('registration_date'), entry.get('output_data', ''),
                        batch_filename, sw_id,
                    ),
                )
            else:
                conn.execute(
                    "INSERT INTO software (user_id, title, certificate_number, "
                    "registration_date, output_data, docx_filename) VALUES (?,?,?,?,?,?)",
                    (
                        user['id'], entry['title'], entry['certificate_number'],
                        entry.get('registration_date'), entry.get('output_data', ''),
                        batch_filename,
                    ),
                )
                sw_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

            conn.execute("DELETE FROM software_authors WHERE software_id=?", (sw_id,))
            for author in entry['authors']:
                conn.execute(
                    "INSERT INTO software_authors "
                    "(software_id, full_name, position, contribution_percent, points_claimed) "
                    "VALUES (?,?,?,?,?)",
                    (
                        sw_id, author['full_name'], author['position'],
                        author['contribution_percent'], author['points_claimed'],
                    ),
                )
            results.append({
                'certificate_number': entry['certificate_number'],
                'id': sw_id,
                'already_used': False,
            })
        conn.commit()
    except HTTPException:
        conn.rollback()
        conn.close()
        _delete_upload(batch_filename)
        raise
    except Exception as exc:
        conn.rollback()
        conn.close()
        _delete_upload(batch_filename)
        raise HTTPException(400, f"Не удалось зарегистрировать пакет ПО: {exc}") from exc
    conn.close()

    for old_filename in old_docx_filenames - {batch_filename}:
        _delete_upload_if_unreferenced(old_filename)
    return {
        'ok': True,
        'registered_count': len(results),
        'results': results + skipped,
        'docx_filename': batch_filename,
    }


@app.post("/api/software")
async def create_software(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'title', 'certificate_number')
    cert = normalize_certificate_number(data.get('certificate_number', ''))
    data['certificate_number'] = cert
    conn = get_db()
    existing = _find_user_software_by_certificate(conn, user['id'], cert)
    docx_filename = _validate_software_docx(
        conn, data.get('docx_filename'), user['id']
    )
    if existing and existing['is_used']:
        # ПО уже подавалось в отчёт — не дублируем в картотеку, остаётся в архиве «Поданы»
        conn.close()
        if docx_filename and docx_filename != existing['docx_filename']:
            _delete_upload_if_unreferenced(docx_filename)
        return {"id": existing['id'], "ok": True, "already_used": True}

    old_docx_filename = existing['docx_filename'] if existing else None
    if not docx_filename:
        docx_bytes = generate_software_docx(data, user)
        safe_cert = re.sub(r'[^\w]', '_', cert)
        docx_filename = f"sw_manual_{user['id']}_{safe_cert}.docx"
        (UPLOADS_DIR / docx_filename).write_bytes(docx_bytes)

    if existing:
        sw_id = existing['id']
        conn.execute(
            "UPDATE software SET title=?, certificate_number=?, registration_date=?, "
            "output_data=?, docx_filename=? WHERE id=?",
            (data['title'], cert, data.get('registration_date'),
             data.get('output_data', ''), docx_filename, sw_id)
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
    if old_docx_filename and old_docx_filename != docx_filename:
        _delete_upload_if_unreferenced(old_docx_filename)
    return {"id": sw_id, "ok": True, "docx_filename": docx_filename}


@app.get("/api/software/{sw_id}/docx")
def download_software_docx(sw_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM software WHERE id=?", (sw_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "ПО не найдено")
    sw = dict(row)
    if user['role'] not in ('supervisor', 'admin') and sw['user_id'] != user['id']:
        conn.close()
        raise HTTPException(404, "ПО не найдено")
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
    user = _current_user(request)
    content = await _read_upload(file, {".docx"})
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename)
    filename = f"art_{user['id']}_{int(datetime.now().timestamp()*1000)}_{safe_name}"
    path = UPLOADS_DIR / filename
    path.write_bytes(content)
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


@app.post("/api/articles")
async def create_article(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'title', 'article_type')
    conn = get_db()

    # upsert по id (правки статьи при доработке отчёта обновляют запись, без дублей)
    aid = data.get('id')
    existing = None
    if aid:
        existing = conn.execute(
            "SELECT id, is_used FROM articles WHERE id=? AND user_id=?", (aid, user['id'])
        ).fetchone()
        if existing and existing['is_used']:
            conn.close()
            raise HTTPException(400, "Эта статья уже была подана в одном из отчётов")

    if existing:
        conn.execute(
            "UPDATE articles SET title=?, publication=?, authors=?, article_type=?, docx_filename=? WHERE id=?",
            (data['title'], data.get('publication', ''), data.get('authors', ''),
             data['article_type'], data.get('docx_filename', ''), aid)
        )
    else:
        conn.execute(
            "INSERT INTO articles (user_id, title, publication, authors, article_type, docx_filename) VALUES (?,?,?,?,?,?)",
            (user['id'], data['title'], data.get('publication', ''), data.get('authors', ''),
             data['article_type'], data.get('docx_filename', ''))
        )
        aid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute("DELETE FROM article_authors WHERE article_id=?", (aid,))
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
    row = conn.execute("SELECT docx_filename FROM articles WHERE id=? AND is_used=0 AND user_id=?", (article_id, user['id'])).fetchone()
    conn.execute("DELETE FROM articles WHERE id=? AND is_used=0 AND user_id=?", (article_id, user['id']))
    conn.commit()
    conn.close()
    if row:
        _delete_upload_if_unreferenced(row['docx_filename'])
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
    author = conn.execute(
        "SELECT username, last_name, first_patronymic, position, rank FROM users WHERE id=?",
        (report['user_id'],)
    ).fetchone()

    # авторы ПО/статей — нужны, чтобы при доработке отчёта черновик
    # восстанавливался полностью (иначе авторы «слетают»)
    software = []
    for s in sw_list:
        sd = dict(s)
        sd['authors'] = [dict(a) for a in conn.execute(
            "SELECT full_name, position, contribution_percent, points_claimed "
            "FROM software_authors WHERE software_id=? ORDER BY id", (s['id'],)
        ).fetchall()]
        software.append(sd)
    articles = []
    for a in arts:
        ad = dict(a)
        ad['authors'] = [dict(x) for x in conn.execute(
            "SELECT full_name, points FROM article_authors WHERE article_id=? ORDER BY id", (a['id'],)
        ).fetchall()]
        articles.append(ad)

    conn.close()
    return {
        **dict(report),
        **(dict(author) if author else {}),
        "orders": [dict(o) for o in orders],
        "software": software,
        "articles": articles,
        "conferences": [dict(c) for c in confs],
    }


@app.delete("/api/reports/all")
def clear_all_reports(request: Request):
    """Очистить историю отчётов текущего сотрудника: удаляются только сами отчёты
    (со связанными строками — каскадом), файлы .xlsx и снимаются пометки
    «использовано» с ПО/статей, чтобы они вернулись в картотеку. Приказы, ПО и
    статьи как записи остаются.

    TEST-ONLY: массовая очистка нужна только на этапе тестирования.
    УДАЛИТЬ ПЕРЕД ПРОДАКШЕНОМ (эндпоинт + кнопка clearArchive в
    static/js/reports.js + index.html)."""
    user = _current_user(request)
    uid = user['id']
    conn = get_db()
    rows = conn.execute("SELECT xlsx_path FROM monthly_reports WHERE user_id=?", (uid,)).fetchall()
    for row in rows:
        p = Path(row['xlsx_path']) if row['xlsx_path'] else None
        if p and p.exists():
            p.unlink()
    conn.execute("DELETE FROM monthly_reports WHERE user_id=?", (uid,))
    # вернуть ПО/статьи в картотеку (после удаления отчётов они ничем не «поданы»)
    conn.execute("UPDATE software SET is_used=0, used_month=NULL, used_year=NULL WHERE user_id=?", (uid,))
    conn.execute("UPDATE articles SET is_used=0, used_month=NULL, used_year=NULL WHERE user_id=?", (uid,))
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
    if user['role'] not in ('supervisor', 'admin') and row['user_id'] != user['id']:
        raise HTTPException(403, "Доступ запрещён")
    return _get_report_data(report_id)


@app.post("/api/reports/{report_id}/reopen")
def reopen_report(report_id: int, request: Request):
    """Доработка ОТКЛОНЁННОГО отчёта сотрудником: снимаем поданную версию,
    возвращаем связанные ПО/статьи в картотеку (is_used=0) и отдаём позиции,
    чтобы фронтенд восстановил черновик. Сам месяц освобождается для новой подачи."""
    user = _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT user_id, status, year, month, xlsx_path FROM monthly_reports WHERE id=?", (report_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Отчёт не найден")
    if row['user_id'] != user['id']:
        conn.close()
        raise HTTPException(403, "Доступ запрещён")
    if row['status'] not in ('submitted', 'rejected'):
        conn.close()
        raise HTTPException(400, "Дорабатывать можно отчёт на проверке или отклонённый")
    if not _is_current_period(row['year'], row['month']):
        conn.close()
        raise HTTPException(400, "Прошлые месяцы закрыты — доработка доступна только за текущий месяц")

    data = _get_report_data(report_id)   # собираем позиции до удаления

    for s in conn.execute("SELECT software_id FROM report_software WHERE report_id=?", (report_id,)).fetchall():
        conn.execute("UPDATE software SET is_used=0, used_month=NULL, used_year=NULL WHERE id=?", (s['software_id'],))
    for a in conn.execute("SELECT article_id FROM report_articles WHERE report_id=?", (report_id,)).fetchall():
        conn.execute("UPDATE articles SET is_used=0, used_month=NULL, used_year=NULL WHERE id=?", (a['article_id'],))

    if row['xlsx_path']:
        p = Path(row['xlsx_path'])
        if p.exists():
            p.unlink()
    conn.execute("DELETE FROM monthly_reports WHERE id=?", (report_id,))   # каскадом снимает связи
    conn.commit()
    conn.close()
    return data


@app.post("/api/reports/submit")
async def submit_report(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'year', 'month')
    year = data['year']
    month = data['month']
    uid = user['id']

    if not _is_current_period(year, month):
        raise HTTPException(400, "Отчёт можно подавать только за текущий месяц")

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
    if user['role'] not in ('supervisor', 'admin') and row['user_id'] != user['id']:
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


# ── ЛИЧНЫЙ ПЛАН ───────────────────────────────────────────────────────────────

def _own_plan(conn, user: dict, plan_id: int) -> dict:
    row = conn.execute("SELECT * FROM work_plans WHERE id=?", (plan_id,)).fetchone()
    if not row or row['user_id'] != user['id']:
        conn.close()
        raise HTTPException(404, "План не найден")
    return dict(row)


def _plan_nir_months(conn, nir_ids: list) -> dict:
    """{nir_id: {month: hours}}"""
    out = {nid: {} for nid in nir_ids}
    if nir_ids:
        q = "SELECT nir_id, month, hours FROM plan_nir_months WHERE nir_id IN (%s)" % \
            ",".join("?" * len(nir_ids))
        for r in conn.execute(q, nir_ids).fetchall():
            out[r['nir_id']][r['month']] = r['hours']
    return out


def _plan_bundle(conn, uid: int, year: int) -> dict:
    plan = conn.execute("SELECT * FROM work_plans WHERE user_id=? AND year=?",
                        (uid, year)).fetchone()
    eternal = [dict(r) for r in conn.execute(
        "SELECT * FROM eternal_operatives WHERE user_id=? AND is_active=1 "
        "ORDER BY sort_order, id", (uid,)).fetchall()]
    eternal_total = sum(o['hours_month'] for o in eternal)
    if not plan:
        return {"plan": None, "year": year, "eternal_ops": eternal,
                "eternal_total": eternal_total}
    plan = dict(plan)
    nirs = [dict(r) for r in conn.execute(
        "SELECT * FROM plan_nirs WHERE plan_id=? ORDER BY sort_order, id",
        (plan['id'],)).fetchall()]
    months = [dict(r) for r in conn.execute(
        "SELECT * FROM plan_months WHERE plan_id=? ORDER BY month",
        (plan['id'],)).fetchall()]
    nir_months = _plan_nir_months(conn, [n['id'] for n in nirs])
    for n in nirs:
        n['months'] = nir_months[n['id']]
    norms = {}
    for r in months:
        m = r['month']
        norms[m] = (sum(nm.get(m, 0) for nm in nir_months.values())
                    + r['hours_articles'] + r['hours_operatives']
                    + r['hours_naryady'] + r['hours_guk'])
    return {
        "plan": plan, "year": year, "nirs": nirs, "months": months,
        "eternal_ops": eternal, "eternal_total": eternal_total, "norms": norms,
        "vacation": plan_calc.vacation_summary(plan, nirs, months),
        "warnings": plan_calc.validate(plan, nirs, months, nir_months, eternal_total),
    }


@app.get("/api/plan")
def get_plan(request: Request, year: int = 0):
    user = _current_user(request)
    if not year:
        year = _current_period()[0]
    conn = get_db()
    bundle = _plan_bundle(conn, user['id'], year)
    conn.close()
    return bundle


@app.post("/api/plan")
async def save_plan(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'year')
    year = int(data['year'])
    fields = (
        int(data.get('hours_articles') or 0),
        int(data.get('hours_operatives') or 0),
        int(data.get('hours_naryady') or 0),
        int(data.get('hours_guk') or 0),
        (data.get('fio_genitive') or '').strip(),
        (data.get('approver_position') or 'Начальник 5 научно-исследовательского отдела').strip(),
        (data.get('approver_rank') or 'подполковник').strip(),
        (data.get('approver_name') or 'С.Тихонов').strip(),
    )
    conn = get_db()
    row = conn.execute("SELECT id FROM work_plans WHERE user_id=? AND year=?",
                       (user['id'], year)).fetchone()
    if row:
        pid = row['id']
        conn.execute(
            "UPDATE work_plans SET hours_articles=?, hours_operatives=?, hours_naryady=?, "
            "hours_guk=?, fio_genitive=?, approver_position=?, approver_rank=?, "
            "approver_name=? WHERE id=?", fields + (pid,))
    else:
        conn.execute(
            "INSERT INTO work_plans (user_id, year, hours_articles, hours_operatives, "
            "hours_naryady, hours_guk, fio_genitive, approver_position, approver_rank, "
            "approver_name) VALUES (?,?,?,?,?,?,?,?,?,?)", (user['id'], year) + fields)
        pid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    for m in range(1, 13):
        conn.execute("INSERT OR IGNORE INTO plan_months (plan_id, month) VALUES (?,?)",
                     (pid, m))
    for mr in (data.get('months') or []):
        conn.execute("UPDATE plan_months SET fund_hours=? WHERE plan_id=? AND month=?",
                     (int(mr.get('fund_hours') or 0), pid, int(mr['month'])))
    conn.commit()
    bundle = _plan_bundle(conn, user['id'], year)
    conn.close()
    return bundle


@app.post("/api/plan/{plan_id}/nirs")
async def add_plan_nir(plan_id: int, request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'name')
    conn = get_db()
    _own_plan(conn, user, plan_id)
    dm = data.get('deadline_month')
    conn.execute(
        "INSERT INTO plan_nirs (plan_id, name, deadline_month, hours_year, sort_order) "
        "VALUES (?,?,?,?,?)",
        (plan_id, data['name'].strip(), int(dm) if dm else None,
         int(data.get('hours_year') or 0), int(data.get('sort_order') or 0)))
    nid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    conn.close()
    return {"id": nid}


@app.put("/api/plan/nirs/{nir_id}")
async def update_plan_nir(nir_id: int, request: Request):
    user = _current_user(request)
    data = await request.json()
    conn = get_db()
    row = conn.execute(
        "SELECT n.*, p.user_id FROM plan_nirs n JOIN work_plans p ON n.plan_id=p.id "
        "WHERE n.id=?", (nir_id,)).fetchone()
    if not row or row['user_id'] != user['id']:
        conn.close()
        raise HTTPException(404, "НИР не найдена")
    dm = data.get('deadline_month', row['deadline_month'])
    conn.execute(
        "UPDATE plan_nirs SET name=?, deadline_month=?, hours_year=? WHERE id=?",
        ((data.get('name') or row['name']).strip(), int(dm) if dm else None,
         int(data.get('hours_year') if data.get('hours_year') is not None
             else row['hours_year']), nir_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/plan/nirs/{nir_id}")
def delete_plan_nir(nir_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    row = conn.execute(
        "SELECT n.id, p.user_id FROM plan_nirs n JOIN work_plans p ON n.plan_id=p.id "
        "WHERE n.id=?", (nir_id,)).fetchone()
    if not row or row['user_id'] != user['id']:
        conn.close()
        raise HTTPException(404, "НИР не найдена")
    conn.execute("DELETE FROM plan_nirs WHERE id=?", (nir_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.put("/api/plan/{plan_id}/vacation")
async def update_plan_vacation(plan_id: int, request: Request):
    user = _current_user(request)
    data = await request.json()
    conn = get_db()
    plan = _own_plan(conn, user, plan_id)
    for mr in (data.get('months') or []):
        conn.execute("UPDATE plan_months SET vacation_days=? WHERE plan_id=? AND month=?",
                     (int(mr.get('vacation_days') or 0), plan_id, int(mr['month'])))
    conn.commit()
    bundle = _plan_bundle(conn, user['id'], plan['year'])
    conn.close()
    return bundle


@app.post("/api/plan/{plan_id}/distribute")
def distribute_plan(plan_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    plan = _own_plan(conn, user, plan_id)
    nirs = [dict(r) for r in conn.execute(
        "SELECT * FROM plan_nirs WHERE plan_id=? ORDER BY sort_order, id",
        (plan_id,)).fetchall()]
    months = [dict(r) for r in conn.execute(
        "SELECT * FROM plan_months WHERE plan_id=? ORDER BY month", (plan_id,)).fetchall()]
    eternal_total = conn.execute(
        "SELECT COALESCE(SUM(hours_month),0) FROM eternal_operatives "
        "WHERE user_id=? AND is_active=1", (user['id'],)).fetchone()[0]
    res = plan_calc.distribute(plan, nirs, months, eternal_total)
    for m in range(1, 13):
        c = res['cells'][m]
        conn.execute(
            "UPDATE plan_months SET hours_articles=?, hours_operatives=?, "
            "hours_naryady=?, hours_guk=? WHERE plan_id=? AND month=?",
            (c['articles'], c['operatives'], c['naryady'], c['guk'], plan_id, m))
    for nid, nm in res['nir_months'].items():
        conn.execute("DELETE FROM plan_nir_months WHERE nir_id=?", (nid,))
        for m, h in nm.items():
            if h:
                conn.execute(
                    "INSERT INTO plan_nir_months (nir_id, month, hours) VALUES (?,?,?)",
                    (nid, m, h))
    conn.commit()
    bundle = _plan_bundle(conn, user['id'], plan['year'])
    bundle['distribute_warnings'] = res['warnings']
    conn.close()
    return bundle


@app.put("/api/plan/{plan_id}/cells")
async def update_plan_cells(plan_id: int, request: Request):
    user = _current_user(request)
    data = await request.json()
    conn = get_db()
    plan = _own_plan(conn, user, plan_id)
    for mr in (data.get('months') or []):
        conn.execute(
            "UPDATE plan_months SET hours_articles=?, hours_operatives=?, "
            "hours_naryady=?, hours_guk=? WHERE plan_id=? AND month=?",
            (int(mr.get('hours_articles') or 0), int(mr.get('hours_operatives') or 0),
             int(mr.get('hours_naryady') or 0), int(mr.get('hours_guk') or 0),
             plan_id, int(mr['month'])))
    for nm in (data.get('nir_months') or []):
        own = conn.execute(
            "SELECT n.id FROM plan_nirs n WHERE n.id=? AND n.plan_id=?",
            (int(nm['nir_id']), plan_id)).fetchone()
        if not own:
            continue
        h = int(nm.get('hours') or 0)
        conn.execute(
            "INSERT INTO plan_nir_months (nir_id, month, hours) VALUES (?,?,?) "
            "ON CONFLICT(nir_id, month) DO UPDATE SET hours=?",
            (int(nm['nir_id']), int(nm['month']), h, h))
    conn.commit()
    bundle = _plan_bundle(conn, user['id'], plan['year'])
    conn.close()
    return bundle


# — вечные оперативки —

@app.get("/api/plan/eternal-ops")
def list_eternal_ops(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM eternal_operatives WHERE user_id=? AND is_active=1 "
        "ORDER BY sort_order, id", (user['id'],)).fetchall()]
    conn.close()
    return rows


@app.post("/api/plan/eternal-ops")
async def add_eternal_op(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'name')
    conn = get_db()
    conn.execute(
        "INSERT INTO eternal_operatives (user_id, name, goal, tasks, result, doc, "
        "hours_month, sort_order) VALUES (?,?,?,?,?,?,?,?)",
        (user['id'], data['name'].strip(), data.get('goal') or '',
         data.get('tasks') or '', data.get('result') or '', data.get('doc') or '',
         int(data.get('hours_month') or 0), int(data.get('sort_order') or 0)))
    oid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    conn.close()
    return {"id": oid}


@app.put("/api/plan/eternal-ops/{op_id}")
async def update_eternal_op(op_id: int, request: Request):
    user = _current_user(request)
    data = await request.json()
    conn = get_db()
    row = conn.execute("SELECT * FROM eternal_operatives WHERE id=? AND user_id=?",
                       (op_id, user['id'])).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Оперативка не найдена")
    conn.execute(
        "UPDATE eternal_operatives SET name=?, goal=?, tasks=?, result=?, doc=?, "
        "hours_month=? WHERE id=?",
        ((data.get('name') or row['name']).strip(),
         data.get('goal', row['goal']), data.get('tasks', row['tasks']),
         data.get('result', row['result']), data.get('doc', row['doc']),
         int(data.get('hours_month') if data.get('hours_month') is not None
             else row['hours_month']), op_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/plan/eternal-ops/{op_id}")
def delete_eternal_op(op_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    conn.execute("UPDATE eternal_operatives SET is_active=0 WHERE id=? AND user_id=?",
                 (op_id, user['id']))
    conn.commit()
    conn.close()
    return {"ok": True}


# — месячный план-отчёт —

def _plan_month_data(conn, user: dict, year: int, month: int) -> dict:
    """Данные месяца для конструктора/генерации: план, строка месяца, НИРы, вечные."""
    plan = conn.execute("SELECT * FROM work_plans WHERE user_id=? AND year=?",
                        (user['id'], year)).fetchone()
    if not plan:
        conn.close()
        raise HTTPException(404, "Сначала создайте годовой план")
    plan = dict(plan)
    mrow = conn.execute("SELECT * FROM plan_months WHERE plan_id=? AND month=?",
                        (plan['id'], month)).fetchone()
    mrow = dict(mrow) if mrow else dict(month=month, fund_hours=0, vacation_days=0,
                                        hours_articles=0, hours_operatives=0,
                                        hours_naryady=0, hours_guk=0)
    nirs = [dict(r) for r in conn.execute(
        "SELECT * FROM plan_nirs WHERE plan_id=? ORDER BY sort_order, id",
        (plan['id'],)).fetchall()]
    nir_months = _plan_nir_months(conn, [n['id'] for n in nirs])
    nir_rows = [{"nir_id": n['id'], "name": n['name'],
                 "hours": nir_months[n['id']].get(month, 0)}
                for n in nirs if nir_months[n['id']].get(month, 0) > 0]
    eternal = [dict(r) for r in conn.execute(
        "SELECT * FROM eternal_operatives WHERE user_id=? AND is_active=1 "
        "ORDER BY sort_order, id", (user['id'],)).fetchall()]
    eternal_total = sum(o['hours_month'] for o in eternal)
    nir_sum = sum(r['hours'] for r in nir_rows)
    norm = (nir_sum + mrow['hours_articles'] + mrow['hours_operatives']
            + mrow['hours_naryady'] + mrow['hours_guk'])
    # годовые итоги для шапки
    all_months = [dict(r) for r in conn.execute(
        "SELECT * FROM plan_months WHERE plan_id=?", (plan['id'],)).fetchall()]
    nir_year = sum(sum(nm.values()) for nm in nir_months.values())
    resource_year = nir_year + sum(r['hours_articles'] + r['hours_operatives']
                                   + r['hours_naryady'] + r['hours_guk']
                                   for r in all_months)
    naryad_year = sum(r['hours_naryady'] for r in all_months)
    return dict(plan=plan, mrow=mrow, nir_rows=nir_rows, eternal_ops=eternal,
                eternal_total=eternal_total, norm=norm,
                resource_year=resource_year, nr_year=resource_year - naryad_year)


@app.get("/api/plan/report-data")
def plan_report_data(year: int, month: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    d = _plan_month_data(conn, user, year, month)
    articles = [dict(r) for r in conn.execute(
        "SELECT id, title FROM articles WHERE user_id=? ORDER BY created_at DESC",
        (user['id'],)).fetchall()]
    software = [dict(r) for r in conn.execute(
        "SELECT id, title FROM software WHERE user_id=? ORDER BY created_at DESC",
        (user['id'],)).fetchall()]
    conferences = [dict(r) for r in conn.execute(
        "SELECT c.id, c.title FROM conferences c "
        "JOIN monthly_reports mr ON c.report_id = mr.id WHERE mr.user_id=? "
        "ORDER BY c.id DESC", (user['id'],)).fetchall()]
    existing = conn.execute(
        "SELECT * FROM plan_reports WHERE user_id=? AND year=? AND month=?",
        (user['id'], year, month)).fetchone()
    items = []
    if existing:
        items = [dict(r) for r in conn.execute(
            "SELECT * FROM plan_report_items WHERE report_id=? ORDER BY id",
            (existing['id'],)).fetchall()]
    conn.close()
    mrow = d['mrow']
    return {
        "norm": d['norm'], "nir_rows": d['nir_rows'],
        "eternal_ops": d['eternal_ops'], "eternal_total": d['eternal_total'],
        "budgets": {
            "articles": mrow['hours_articles'],
            "operatives": mrow['hours_operatives'],
            "op_flex": max(0, mrow['hours_operatives'] - d['eternal_total']),
            "naryady": mrow['hours_naryady'],
            "guk": mrow['hours_guk'],
        },
        "candidates": {"articles": articles, "software": software,
                       "conferences": conferences},
        "existing": dict(existing) if existing else None,
        "existing_items": items,
    }


@app.post("/api/plan/reports")
async def create_plan_report(request: Request):
    user = _current_user(request)
    data = await request.json()
    _require(data, 'year', 'month')
    year, month = int(data['year']), int(data['month'])
    conn = get_db()
    d = _plan_month_data(conn, user, year, month)
    plan, mrow = d['plan'], d['mrow']

    items = data.get('items') or []
    by_kind = {"article": [], "software": [], "conference": [], "operative": []}
    for it in items:
        kind = it.get('kind')
        if kind in by_kind:
            by_kind[kind].append(it)

    fp = (user.get('first_patronymic') or '').strip()
    fio_sign = ((fp[0] + '.') if fp else '') + (user.get('last_name') or '')
    ctx = dict(
        month=month, year=year,
        fio_rp=plan['fio_genitive'] or ((user.get('last_name') or '') + ' ' + fp),
        fio_sign=fio_sign,
        position=user.get('position') or '',
        appr_position=plan['approver_position'], appr_rank=plan['approver_rank'],
        appr_name=plan['approver_name'],
        resource_year=d['resource_year'], nr_year=d['nr_year'],
        resource_month=d['norm'], nr_month=d['norm'] - mrow['hours_naryady'],
        nirs=[(r['name'], r['hours']) for r in d['nir_rows']],
        conferences=[(it.get('name', ''), int(it.get('hours') or 0))
                     for it in by_kind['conference']],
        articles=[(it.get('name', ''), int(it.get('hours') or 0))
                  for it in by_kind['article']],
        software=[(it.get('name', ''), int(it.get('hours') or 0))
                  for it in by_kind['software']],
        guk_hours=mrow['hours_guk'], naryad_hours=mrow['hours_naryady'],
        eternal_ops=[dict(name=o['name'], goal=o['goal'], tasks=o['tasks'],
                          result=o['result'], doc=o['doc'], hours=o['hours_month'])
                     for o in d['eternal_ops']],
        operatives=[dict(name=it.get('name', ''), goal=it.get('goal', ''),
                         tasks=it.get('tasks', ''), result=it.get('result', ''),
                         doc=it.get('doc', ''), hours=int(it.get('hours') or 0))
                    for it in by_kind['operative']],
    )
    content = generate_plan_docx(ctx)
    path = REPORTS_DIR / f"plan_{user['id']}_{year}_{month:02d}.docx"
    path.write_bytes(content)

    row = conn.execute(
        "SELECT id FROM plan_reports WHERE user_id=? AND year=? AND month=?",
        (user['id'], year, month)).fetchone()
    if row:
        rid = row['id']
        conn.execute("UPDATE plan_reports SET docx_path=?, created_at=datetime('now') "
                     "WHERE id=?", (str(path), rid))
        conn.execute("DELETE FROM plan_report_items WHERE report_id=?", (rid,))
    else:
        conn.execute(
            "INSERT INTO plan_reports (user_id, year, month, docx_path) VALUES (?,?,?,?)",
            (user['id'], year, month, str(path)))
        rid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    for it in items:
        if it.get('kind') not in by_kind:
            continue
        conn.execute(
            "INSERT INTO plan_report_items (report_id, kind, ref_id, name, goal, tasks, "
            "result, hours) VALUES (?,?,?,?,?,?,?,?)",
            (rid, it['kind'], it.get('ref_id'), it.get('name', ''),
             it.get('goal', ''), it.get('tasks', ''), it.get('result', ''),
             int(it.get('hours') or 0)))
    conn.commit()
    conn.close()
    return {"id": rid}


@app.get("/api/plan/reports")
def list_plan_reports(request: Request):
    user = _current_user(request)
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        "SELECT id, year, month, created_at FROM plan_reports WHERE user_id=? "
        "ORDER BY year DESC, month DESC", (user['id'],)).fetchall()]
    conn.close()
    return rows


@app.get("/api/plan/reports/{report_id}/download")
def download_plan_report(report_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM plan_reports WHERE id=?", (report_id,)).fetchone()
    conn.close()
    if not row or row['user_id'] != user['id']:
        raise HTTPException(404, "Отчёт не найден")
    p = Path(row['docx_path'] or '')
    if not row['docx_path'] or not p.exists():
        raise HTTPException(404, "Файл не найден на диске")
    return FileResponse(
        str(p),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"Личный_план_{MONTHS_RU[row['month']]}_{row['year']}.docx"
    )


@app.delete("/api/plan/reports/{report_id}")
def delete_plan_report(report_id: int, request: Request):
    user = _current_user(request)
    conn = get_db()
    row = conn.execute("SELECT * FROM plan_reports WHERE id=?", (report_id,)).fetchone()
    if not row or row['user_id'] != user['id']:
        conn.close()
        raise HTTPException(404, "Отчёт не найден")
    if row['docx_path']:
        try:
            Path(row['docx_path']).unlink(missing_ok=True)
        except Exception:
            pass
    conn.execute("DELETE FROM plan_reports WHERE id=?", (report_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── SUPERVISOR ────────────────────────────────────────────────────────────────

@app.get("/api/supervisor/employees")
def supervisor_employees(request: Request):
    actor = _require_supervisor(request)
    conn = get_db()
    if actor['role'] == 'admin':
        users = conn.execute(
            "SELECT id, username, role, last_name, first_patronymic, position, rank, "
            "unit, active, must_change_password, last_login_at, locked_until "
            "FROM users ORDER BY active DESC, role DESC, last_name"
        ).fetchall()
    else:
        users = conn.execute(
            "SELECT id, username, role, last_name, first_patronymic, position, rank, "
            "unit, active, must_change_password, last_login_at, locked_until "
            "FROM users WHERE role='employee' ORDER BY active DESC, last_name"
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


@app.post("/api/supervisor/reports/{report_id}/reopen")
def supervisor_reopen_report(report_id: int, request: Request):
    """Снять решение (утверждён/отклонён) и вернуть отчёт на проверку.
    Используется, если начальник передумал или ошибся — только для текущего месяца."""
    _require_supervisor(request)
    conn = get_db()
    row = conn.execute("SELECT year, month FROM monthly_reports WHERE id=?", (report_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Отчёт не найден")
    if not _is_current_period(row['year'], row['month']):
        conn.close()
        raise HTTPException(400, "Прошлые месяцы закрыты — решение по ним изменить нельзя")
    conn.execute("UPDATE monthly_reports SET status='submitted', supervisor_comment='' WHERE id=?", (report_id,))
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
    # чистим осиротевшие вложения (подтверждения приказов, сертификаты докладов)
    for r in conn.execute("SELECT confirmation_filename FROM report_orders WHERE report_id=?", (report_id,)).fetchall():
        _delete_upload(r['confirmation_filename'])
    for r in conn.execute("SELECT certificate_filename FROM conferences WHERE report_id=?", (report_id,)).fetchall():
        _delete_upload(r['certificate_filename'])
    conn.execute("DELETE FROM monthly_reports WHERE id=?", (report_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/supervisor/deposits")
def supervisor_deposits(request: Request):
    """Общий архив РИД: все ПОДАННЫЕ (is_used=1) ПО и статьи всех сотрудников.
    Неподанные чужие достижения не отдаются (приватность)."""
    _require_supervisor(request)
    conn = get_db()
    users = {u['id']: dict(u) for u in conn.execute(
        "SELECT id, username, last_name, first_patronymic, rank FROM users"
    ).fetchall()}
    out = []
    for s in conn.execute(
        "SELECT id, user_id, title, certificate_number, registration_date, used_month, used_year, docx_filename "
        "FROM software WHERE is_used=1"
    ).fetchall():
        d = dict(s); d['kind'] = 'po'; d['owner'] = users.get(d['user_id'])
        out.append(d)
    for a in conn.execute(
        "SELECT id, user_id, title, publication, article_type, used_month, used_year, docx_filename "
        "FROM articles WHERE is_used=1"
    ).fetchall():
        d = dict(a); d['kind'] = 'article'; d['owner'] = users.get(d['user_id'])
        out.append(d)
    conn.close()
    return out


def _current_notifications(conn, user: dict) -> list:
    """Активные (не скрытые) уведомления пользователя.
    Начальник: отчёты, поданные на проверку. Сотрудник: возвращённые с замечанием
    и утверждённые (за текущий месяц). Список самоочищается по смене статуса."""
    notes = []
    if user['role'] in ('supervisor', 'admin'):
        rows = conn.execute("""
            SELECT mr.id, mr.year, mr.month, mr.submitted_at,
                   u.username, u.last_name, u.first_patronymic
            FROM monthly_reports mr JOIN users u ON mr.user_id = u.id
            WHERE mr.status = 'submitted'
              AND NOT EXISTS (SELECT 1 FROM dismissed_notifications dn
                              WHERE dn.user_id = ? AND dn.report_id = mr.id
                                AND dn.kind = 'submitted')
            ORDER BY mr.submitted_at DESC
        """, (user['id'],)).fetchall()
        for r in rows:
            notes.append({
                "kind": "submitted", "report_id": r['id'],
                "year": r['year'], "month": r['month'], "when": r['submitted_at'],
                "username": r['username'], "last_name": r['last_name'],
                "first_patronymic": r['first_patronymic'],
            })
    else:
        cy, cm = _current_period()
        rows = conn.execute("""
            SELECT id, year, month, status, supervisor_comment, submitted_at
            FROM monthly_reports
            WHERE user_id = ? AND (status = 'rejected' OR (status = 'approved' AND year = ? AND month = ?))
              AND NOT EXISTS (SELECT 1 FROM dismissed_notifications dn
                              WHERE dn.user_id = monthly_reports.user_id
                                AND dn.report_id = monthly_reports.id
                                AND dn.kind = monthly_reports.status)
            ORDER BY submitted_at DESC
        """, (user['id'], cy, cm)).fetchall()
        for r in rows:
            notes.append({
                "kind": r['status'], "report_id": r['id'],
                "year": r['year'], "month": r['month'], "when": r['submitted_at'],
                "comment": r['supervisor_comment'] or '',
            })
    return notes


@app.get("/api/notifications")
def get_notifications(request: Request):
    user = _current_user(request)
    conn = get_db()
    notes = _current_notifications(conn, user)
    conn.close()
    return notes


@app.post("/api/notifications/dismiss")
async def dismiss_notification(request: Request):
    """Скрыть уведомление навсегда (по отчёту и виду). Пустой report_id → закрыть все."""
    user = _current_user(request)
    data = await request.json()
    conn = get_db()
    if data.get('report_id'):
        conn.execute(
            "INSERT OR IGNORE INTO dismissed_notifications (user_id, report_id, kind) "
            "VALUES (?,?,?)",
            (user['id'], int(data['report_id']), data.get('kind') or ''))
    else:
        # закрыть все текущие уведомления пользователя
        for n in _current_notifications(conn, user):
            conn.execute(
                "INSERT OR IGNORE INTO dismissed_notifications (user_id, report_id, kind) "
                "VALUES (?,?,?)", (user['id'], n['report_id'], n['kind']))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard(request: Request, year: int, month: int):
    """Агрегаты по подразделению за выбранный месяц (для начальника).
    Снимки прошлых месяцев берутся прямо из monthly_reports."""
    _require_supervisor(request)
    conn = get_db()
    employees = conn.execute(
        "SELECT id, username, last_name, first_patronymic, position, rank "
        "FROM users WHERE role='employee' AND active=1 ORDER BY last_name"
    ).fetchall()
    total = len(employees)

    st = {'submitted': 0, 'approved': 0, 'rejected': 0}   # submitted = ждут проверки
    submitted_count = 0
    ranking = []
    rids = []

    for u in employees:
        rep = conn.execute(
            "SELECT id, total_points, status FROM monthly_reports "
            "WHERE user_id=? AND year=? AND month=?", (u['id'], year, month)
        ).fetchone()
        entry = dict(u)
        if rep:
            submitted_count += 1
            if rep['status'] in st:
                st[rep['status']] += 1
            rids.append(rep['id'])
            entry.update(status=rep['status'], pts=rep['total_points'] or 0, report_id=rep['id'])
        else:
            entry.update(status='none', pts=0, report_id=None)
        ranking.append(entry)

    # Счётчики достижений — БЕЗ задвоения соавторства: одна статья/ПО/приказ
    # нескольких сотрудников академии считается один раз (по естественному ключу).
    counts = {'software': 0, 'articles': 0, 'conferences': 0, 'orders': 0}
    if rids:
        ph = ','.join('?' * len(rids))
        counts['software'] = conn.execute(
            f"SELECT COUNT(DISTINCT s.certificate_number) FROM report_software rs "
            f"JOIN software s ON rs.software_id=s.id WHERE rs.report_id IN ({ph})", rids).fetchone()[0]
        counts['articles'] = conn.execute(
            f"SELECT COUNT(DISTINCT lower(trim(a.title))) FROM report_articles ra "
            f"JOIN articles a ON ra.article_id=a.id WHERE ra.report_id IN ({ph})", rids).fetchone()[0]
        counts['orders'] = conn.execute(
            f"SELECT COUNT(DISTINCT order_id) FROM report_orders WHERE report_id IN ({ph})", rids).fetchone()[0]
        counts['conferences'] = conn.execute(
            f"SELECT COUNT(*) FROM conferences WHERE report_id IN ({ph})", rids).fetchone()[0]

    conn.close()
    ranking.sort(key=lambda x: x['pts'], reverse=True)
    return {
        'period': {'year': year, 'month': month},
        'statuses': {
            'total': total,
            'submitted_count': submitted_count,
            'not_submitted': total - submitted_count,
            'pending': st['submitted'],
            'approved': st['approved'],
            'rejected': st['rejected'],
        },
        'counts': counts,
        'ranking': ranking,
    }


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

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    open_browser = os.environ.get("VAS_OPEN_BROWSER", "1").lower() in ("1", "true", "yes")

    if open_browser and host in ("127.0.0.1", "localhost"):
        def _open():
            import time; time.sleep(1); webbrowser.open(f"http://127.0.0.1:{port}")
        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run("main:app", host=host, port=port, reload=False, log_config=log_config)
