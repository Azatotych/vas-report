"""Authentication, password hashing, sessions and security audit."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response
from pwdlib import PasswordHash

from db import get_db


PASSWORD_HASH = PasswordHash.recommended()
SESSION_COOKIE = os.environ.get("VAS_SESSION_COOKIE", "vas_session")
SESSION_HOURS = max(1, int(os.environ.get("VAS_SESSION_HOURS", "12")))
COOKIE_SECURE = os.environ.get("VAS_COOKIE_SECURE", "0").lower() in ("1", "true", "yes")
TRUST_PROXY = os.environ.get("VAS_TRUST_PROXY", "0").lower() in ("1", "true", "yes")
LOGIN_LOCK_ATTEMPTS = max(3, int(os.environ.get("VAS_LOGIN_LOCK_ATTEMPTS", "5")))
LOGIN_LOCK_MINUTES = max(1, int(os.environ.get("VAS_LOGIN_LOCK_MINUTES", "15")))
IP_ATTEMPT_LIMIT = max(10, int(os.environ.get("VAS_IP_ATTEMPT_LIMIT", "20")))

_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")
_DUMMY_HASH: str | None = None
_PUBLIC_USER_FIELDS = (
    "id", "username", "role", "last_name", "first_patronymic", "position",
    "rank", "unit", "active", "must_change_password", "last_login_at",
    "locked_until", "created_at",
)
_PASSWORD_CHANGE_PATHS = {
    "/api/me", "/api/session", "/api/account/password", "/api/version",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime | None = None) -> str:
    return (value or utcnow()).replace(microsecond=0).isoformat()


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def validate_username(username: str) -> str | None:
    normalized = normalize_username(username)
    if not _USERNAME_RE.fullmatch(normalized):
        return "Логин: 3–64 символа, латинские буквы, цифры, точка, дефис или подчёркивание"
    return None


def validate_password(password: str, username: str = "") -> str | None:
    if len(password or "") < 12:
        return "Пароль должен содержать не менее 12 символов"
    if len(password) > 128:
        return "Пароль не должен превышать 128 символов"
    normalized = normalize_username(username)
    if normalized and normalized in password.lower():
        return "Пароль не должен содержать логин"
    return None


def hash_password(password: str) -> str:
    return PASSWORD_HASH.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return PASSWORD_HASH.verify(password, password_hash)
    except Exception:
        return False


def generate_temporary_password(length: int = 16) -> str:
    """Generate a readable temporary password with all essential character classes."""
    length = max(14, length)
    lower = "abcdefghjkmnpqrstuvwxyz"
    upper = "ABCDEFGHJKMNPQRSTUVWXYZ"
    digits = "23456789"
    symbols = "!_-"
    chars = [
        secrets.choice(lower), secrets.choice(upper),
        secrets.choice(digits), secrets.choice(symbols),
    ]
    alphabet = lower + upper + digits + symbols
    chars.extend(secrets.choice(alphabet) for _ in range(length - len(chars)))
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    if TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


def audit_event(
    conn,
    event_type: str,
    request: Request | None = None,
    *,
    user_id: int | None = None,
    target_type: str = "",
    target_id: int | str | None = None,
    details: dict | None = None,
):
    conn.execute(
        "INSERT INTO audit_events "
        "(user_id, event_type, target_type, target_id, details, ip_address, user_agent, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (
            user_id, event_type, target_type, str(target_id or ""),
            json.dumps(details or {}, ensure_ascii=False, separators=(",", ":")),
            client_ip(request),
            (request.headers.get("user-agent", "")[:300] if request else ""),
            iso_utc(),
        ),
    )


def public_user(user: dict) -> dict:
    return {key: user.get(key) for key in _PUBLIC_USER_FIELDS if key in user}


def _dummy_verify(password: str):
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("VAS-dummy-password-not-for-login")
    verify_password(password or "", _DUMMY_HASH)


def _ip_rate_limited(conn, request: Request) -> bool:
    ip = client_ip(request)
    if not ip:
        return False
    since = iso_utc(utcnow() - timedelta(minutes=LOGIN_LOCK_MINUTES))
    count = conn.execute(
        "SELECT COUNT(*) FROM audit_events "
        "WHERE ip_address=? AND event_type='login_failed' AND created_at>=?",
        (ip, since),
    ).fetchone()[0]
    return count >= IP_ATTEMPT_LIMIT


def authenticate(username: str, password: str, request: Request) -> dict:
    normalized = normalize_username(username)
    conn = get_db()

    if _ip_rate_limited(conn, request):
        audit_event(conn, "login_rate_limited", request, details={"username": normalized})
        conn.commit()
        conn.close()
        raise HTTPException(429, "Слишком много попыток входа. Повторите позднее")

    row = conn.execute(
        "SELECT * FROM users WHERE lower(username)=?", (normalized,)
    ).fetchone()
    user = dict(row) if row else None

    if not user or not user.get("active") or not user.get("password_hash"):
        _dummy_verify(password)
        audit_event(
            conn, "login_failed", request,
            user_id=user["id"] if user else None,
            details={"username": normalized, "reason": "invalid_credentials"},
        )
        conn.commit()
        conn.close()
        raise HTTPException(401, "Неверный логин или пароль")

    locked_until = parse_datetime(user.get("locked_until"))
    if locked_until and locked_until > utcnow():
        audit_event(conn, "login_blocked", request, user_id=user["id"])
        conn.commit()
        conn.close()
        raise HTTPException(429, "Учётная запись временно заблокирована")

    try:
        valid, updated_hash = PASSWORD_HASH.verify_and_update(password, user["password_hash"])
    except Exception:
        valid, updated_hash = False, None
    if not valid:
        attempts = int(user.get("failed_login_attempts") or 0) + 1
        lock_value = None
        if attempts >= LOGIN_LOCK_ATTEMPTS:
            lock_value = iso_utc(utcnow() + timedelta(minutes=LOGIN_LOCK_MINUTES))
        conn.execute(
            "UPDATE users SET failed_login_attempts=?, locked_until=? WHERE id=?",
            (attempts, lock_value, user["id"]),
        )
        audit_event(
            conn, "login_failed", request, user_id=user["id"],
            details={"username": normalized, "locked": bool(lock_value)},
        )
        conn.commit()
        conn.close()
        if lock_value:
            raise HTTPException(429, "Учётная запись временно заблокирована")
        raise HTTPException(401, "Неверный логин или пароль")

    last_login = iso_utc()
    if updated_hash:
        conn.execute(
            "UPDATE users SET password_hash=?, failed_login_attempts=0, "
            "locked_until=NULL, last_login_at=? WHERE id=?",
            (updated_hash, last_login, user["id"]),
        )
    else:
        conn.execute(
            "UPDATE users SET failed_login_attempts=0, locked_until=NULL, "
            "last_login_at=? WHERE id=?",
            (last_login, user["id"]),
        )
    audit_event(conn, "login_success", request, user_id=user["id"])
    conn.commit()
    conn.close()
    user["last_login_at"] = last_login
    user["failed_login_attempts"] = 0
    user["locked_until"] = None
    return user


def create_session(user_id: int, request: Request) -> str:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    conn = get_db()
    conn.execute(
        "INSERT INTO user_sessions "
        "(token_hash, user_id, created_at, last_seen_at, expires_at, ip_address, user_agent) "
        "VALUES (?,?,?,?,?,?,?)",
        (
            token_hash(token), user_id, iso_utc(now), iso_utc(now),
            iso_utc(now + timedelta(hours=SESSION_HOURS)), client_ip(request),
            request.headers.get("user-agent", "")[:300],
        ),
    )
    conn.commit()
    conn.close()
    return token


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        SESSION_COOKIE, token,
        httponly=True, secure=COOKIE_SECURE, samesite="strict",
        max_age=SESSION_HOURS * 3600, path="/",
    )


def clear_session_cookie(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie("vas_uid", path="/")


def authenticated_user(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token:
        raise HTTPException(401, "Не авторизован")
    conn = get_db()
    row = conn.execute(
        "SELECT u.*, s.id AS _session_id, s.created_at AS _session_created_at, "
        "s.last_seen_at AS _session_last_seen_at, s.expires_at AS _session_expires_at "
        "FROM user_sessions s JOIN users u ON u.id=s.user_id "
        "WHERE s.token_hash=? AND s.revoked_at IS NULL",
        (token_hash(token),),
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(401, "Сессия недействительна")
    user = dict(row)
    expires = parse_datetime(user.get("_session_expires_at"))
    if not user.get("active") or not expires or expires <= utcnow():
        conn.execute(
            "UPDATE user_sessions SET revoked_at=? WHERE id=?",
            (iso_utc(), user["_session_id"]),
        )
        conn.commit()
        conn.close()
        raise HTTPException(401, "Сессия истекла")

    last_seen = parse_datetime(user.get("_session_last_seen_at"))
    if not last_seen or utcnow() - last_seen > timedelta(minutes=5):
        conn.execute(
            "UPDATE user_sessions SET last_seen_at=? WHERE id=?",
            (iso_utc(), user["_session_id"]),
        )
        conn.commit()
    conn.close()

    if user.get("must_change_password") and request.url.path not in _PASSWORD_CHANGE_PATHS:
        raise HTTPException(403, "Необходимо изменить временный пароль")
    user.pop("password_hash", None)
    return user


def revoke_session_token(token: str, request: Request | None = None):
    if not token:
        return
    conn = get_db()
    row = conn.execute(
        "SELECT id, user_id FROM user_sessions WHERE token_hash=? AND revoked_at IS NULL",
        (token_hash(token),),
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE user_sessions SET revoked_at=? WHERE id=?",
            (iso_utc(), row["id"]),
        )
        audit_event(conn, "logout", request, user_id=row["user_id"])
        conn.commit()
    conn.close()


def revoke_user_sessions(conn, user_id: int, keep_session_id: int | None = None):
    if keep_session_id:
        conn.execute(
            "UPDATE user_sessions SET revoked_at=? "
            "WHERE user_id=? AND id<>? AND revoked_at IS NULL",
            (iso_utc(), user_id, keep_session_id),
        )
    else:
        conn.execute(
            "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
            (iso_utc(), user_id),
        )


def cleanup_sessions():
    conn = get_db()
    now = iso_utc()
    conn.execute(
        "DELETE FROM user_sessions "
        "WHERE expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)",
        (now, iso_utc(utcnow() - timedelta(days=30))),
    )
    conn.commit()
    conn.close()
