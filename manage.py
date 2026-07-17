"""Administrative CLI for initial account setup and password recovery."""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from auth import hash_password, iso_utc, normalize_username, validate_password, validate_username
from db import get_db, init_db


def _read_password(username: str) -> str:
    password = os.environ.get("VAS_ADMIN_PASSWORD", "")
    if not password:
        password = getpass.getpass("Пароль: ")
        repeat = getpass.getpass("Повторите пароль: ")
        if password != repeat:
            raise ValueError("Пароли не совпадают")
    error = validate_password(password, username)
    if error:
        raise ValueError(error)
    return password


def bootstrap_admin(args):
    username = normalize_username(args.username)
    error = validate_username(username)
    if error:
        raise ValueError(error)
    password = _read_password(username)
    conn = get_db()
    row = conn.execute("SELECT id FROM users WHERE lower(username)=?", (username,)).fetchone()
    if row:
        conn.execute(
            "UPDATE users SET role='admin', active=1, password_hash=?, "
            "must_change_password=0, failed_login_attempts=0, locked_until=NULL, "
            "password_changed_at=? WHERE id=?",
            (hash_password(password), iso_utc(), row["id"]),
        )
        uid = row["id"]
        action = "обновлена"
    else:
        conn.execute(
            "INSERT INTO users "
            "(username, role, last_name, position, active, password_hash, "
            "must_change_password, password_changed_at) VALUES (?,?,?,?,1,?,0,?)",
            (
                username, "admin", args.last_name or "Администратор",
                args.position or "Администратор системы",
                hash_password(password), iso_utc(),
            ),
        )
        uid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        action = "создана"
    conn.execute(
        "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        (iso_utc(), uid),
    )
    conn.commit()
    conn.close()
    print(f"Учётная запись администратора «{username}» {action}.")


def set_password(args):
    username = normalize_username(args.username)
    password = _read_password(username)
    conn = get_db()
    row = conn.execute("SELECT id FROM users WHERE lower(username)=?", (username,)).fetchone()
    if not row:
        conn.close()
        raise ValueError("Пользователь не найден")
    conn.execute(
        "UPDATE users SET password_hash=?, must_change_password=?, active=1, "
        "failed_login_attempts=0, locked_until=NULL, password_changed_at=? WHERE id=?",
        (hash_password(password), 1 if args.temporary else 0, iso_utc(), row["id"]),
    )
    conn.execute(
        "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        (iso_utc(), row["id"]),
    )
    conn.commit()
    conn.close()
    print(f"Пароль пользователя «{username}» изменён.")


def list_users(_args):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, username, role, active, must_change_password, last_login_at "
        "FROM users ORDER BY role DESC, username"
    ).fetchall()
    conn.close()
    for row in rows:
        state = "активен" if row["active"] else "отключён"
        change = ", временный пароль" if row["must_change_password"] else ""
        print(f"{row['id']:>3}  {row['username']:<24} {row['role']:<10} {state}{change}")


def main():
    parser = argparse.ArgumentParser(description="Управление аккаунтами ВАС")
    sub = parser.add_subparsers(dest="command", required=True)

    p_admin = sub.add_parser("bootstrap-admin", help="создать или восстановить администратора")
    p_admin.add_argument("--username", default="admin")
    p_admin.add_argument("--last-name", default="")
    p_admin.add_argument("--position", default="")
    p_admin.set_defaults(func=bootstrap_admin)

    p_password = sub.add_parser("set-password", help="назначить пароль существующему пользователю")
    p_password.add_argument("username")
    p_password.add_argument("--temporary", action="store_true", help="потребовать смену при входе")
    p_password.set_defaults(func=set_password)

    p_list = sub.add_parser("list-users", help="показать учётные записи")
    p_list.set_defaults(func=list_users)

    init_db()
    try:
        args = parser.parse_args()
        args.func(args)
    except ValueError as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
