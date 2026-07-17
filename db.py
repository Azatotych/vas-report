import sqlite3
import os
from pathlib import Path

DB_PATH = Path(os.environ.get("VAS_DB_PATH", Path(__file__).parent / "data.db"))


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL DEFAULT 'employee',
            last_name TEXT DEFAULT '',
            first_patronymic TEXT DEFAULT '',
            position TEXT DEFAULT '',
            rank TEXT DEFAULT '',
            unit TEXT DEFAULT '',
            active INTEGER DEFAULT 1,
            password_hash TEXT DEFAULT '',
            must_change_password INTEGER DEFAULT 1,
            failed_login_attempts INTEGER DEFAULT 0,
            locked_until TEXT,
            last_login_at TEXT,
            password_changed_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_hash TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            ip_address TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            revoked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            event_type TEXT NOT NULL,
            target_type TEXT DEFAULT '',
            target_id TEXT DEFAULT '',
            details TEXT DEFAULT '{}',
            ip_address TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id, revoked_at);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_ip_type ON audit_events(ip_address, event_type, created_at);

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            number TEXT NOT NULL,
            title TEXT NOT NULL,
            level TEXT NOT NULL,
            deadline_type TEXT NOT NULL,
            deadline_date TEXT,
            order_date TEXT,
            executor TEXT DEFAULT '',
            created_at TEXT DEFAULT (date('now')),
            is_active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS software (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            title TEXT NOT NULL,
            certificate_number TEXT NOT NULL,
            registration_date TEXT,
            output_data TEXT DEFAULT '',
            docx_filename TEXT DEFAULT '',
            is_used INTEGER DEFAULT 0,
            used_month INTEGER,
            used_year INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS software_authors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            software_id INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
            full_name TEXT NOT NULL,
            position TEXT DEFAULT '',
            contribution_percent INTEGER DEFAULT 0,
            points_claimed REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            title TEXT NOT NULL,
            publication TEXT DEFAULT '',
            authors TEXT DEFAULT '',
            article_type TEXT NOT NULL,
            docx_filename TEXT DEFAULT '',
            is_used INTEGER DEFAULT 0,
            used_month INTEGER,
            used_year INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS article_authors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
            full_name TEXT NOT NULL,
            points REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS monthly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            submitted_at TEXT DEFAULT (datetime('now')),
            xlsx_path TEXT,
            total_points REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'submitted',
            supervisor_comment TEXT DEFAULT '',
            UNIQUE(user_id, year, month)
        );

        CREATE TABLE IF NOT EXISTS report_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL REFERENCES monthly_reports(id) ON DELETE CASCADE,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            confirmation_filename TEXT
        );

        CREATE TABLE IF NOT EXISTS report_software (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL REFERENCES monthly_reports(id) ON DELETE CASCADE,
            software_id INTEGER NOT NULL REFERENCES software(id),
            points_taken REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS report_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL REFERENCES monthly_reports(id) ON DELETE CASCADE,
            article_id INTEGER NOT NULL REFERENCES articles(id),
            points_taken REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS conferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL REFERENCES monthly_reports(id) ON DELETE CASCADE,
            title TEXT DEFAULT '',
            certificate_filename TEXT DEFAULT '',
            points_taken REAL DEFAULT 0
        );

        -- ── Личный план работы (часы, docx) ──────────────────────────────────

        CREATE TABLE IF NOT EXISTS work_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            year INTEGER NOT NULL,
            hours_articles INTEGER DEFAULT 0,
            hours_operatives INTEGER DEFAULT 0,
            hours_naryady INTEGER DEFAULT 0,
            hours_guk INTEGER DEFAULT 0,
            fio_genitive TEXT DEFAULT '',
            approver_position TEXT DEFAULT 'Начальник 5 научно-исследовательского отдела',
            approver_rank TEXT DEFAULT 'подполковник',
            approver_name TEXT DEFAULT 'С.Тихонов',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, year)
        );

        CREATE TABLE IF NOT EXISTS plan_nirs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            deadline_month INTEGER,
            hours_year INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS plan_months (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE,
            month INTEGER NOT NULL,
            fund_hours INTEGER DEFAULT 0,
            vacation_days INTEGER DEFAULT 0,
            hours_articles INTEGER DEFAULT 0,
            hours_operatives INTEGER DEFAULT 0,
            hours_naryady INTEGER DEFAULT 0,
            hours_guk INTEGER DEFAULT 0,
            UNIQUE(plan_id, month)
        );

        CREATE TABLE IF NOT EXISTS plan_nir_months (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nir_id INTEGER NOT NULL REFERENCES plan_nirs(id) ON DELETE CASCADE,
            month INTEGER NOT NULL,
            hours INTEGER DEFAULT 0,
            UNIQUE(nir_id, month)
        );

        CREATE TABLE IF NOT EXISTS eternal_operatives (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            goal TEXT DEFAULT '',
            tasks TEXT DEFAULT '',
            result TEXT DEFAULT '',
            doc TEXT DEFAULT '',
            hours_month INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS plan_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            docx_path TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, year, month)
        );

        CREATE TABLE IF NOT EXISTS plan_report_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL REFERENCES plan_reports(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            ref_id INTEGER,
            name TEXT DEFAULT '',
            goal TEXT DEFAULT '',
            tasks TEXT DEFAULT '',
            result TEXT DEFAULT '',
            hours INTEGER DEFAULT 0
        );

        -- Закрытые («прочитанные») уведомления. Уведомления вычисляются из статусов
        -- отчётов; здесь запоминаем, какие пользователь скрыл, по (отчёт, вид).
        CREATE TABLE IF NOT EXISTS dismissed_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            report_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, report_id, kind)
        );
    """)

    # ── Seed users from old profile table (first run on existing DB) ─────────
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        profile = None
        try:
            profile = conn.execute("SELECT * FROM profile WHERE id=1").fetchone()
        except Exception:
            pass
        ln = (profile['last_name'] or '') if profile else ''
        uname = ln.lower() or 'employee'
        conn.execute("""
            INSERT OR IGNORE INTO users (id, username, role, last_name, first_patronymic, position, unit)
            VALUES (1, ?, 'employee', ?, ?, ?, ?)
        """, (uname, ln,
              (profile['first_patronymic'] or '') if profile else '',
              (profile['position'] or '') if profile else '',
              (profile['unit'] or '') if profile else ''))
        conn.execute("""
            INSERT OR IGNORE INTO users (username, role, last_name, position)
            VALUES ('supervisor', 'supervisor', 'Начальник', 'Начальник подразделения')
        """)
        conn.commit()

    # ── migrations ────────────────────────────────────────────────────────────

    # monthly_reports: add user_id, status, supervisor_comment
    # NOTE: recreating the table to fix UNIQUE(year,month) → UNIQUE(user_id,year,month)
    # is done via Python-level check in submit_report; we just add the column here.
    mr_cols = [r[1] for r in conn.execute("PRAGMA table_info(monthly_reports)").fetchall()]
    for col, defn in [
        ('user_id', 'INTEGER NOT NULL DEFAULT 1'),
        ('status', "TEXT NOT NULL DEFAULT 'submitted'"),
        ('supervisor_comment', 'TEXT DEFAULT \'\''),
    ]:
        if col not in mr_cols:
            conn.execute(f"ALTER TABLE monthly_reports ADD COLUMN {col} {defn}")
            conn.commit()

    # users: add active (мягкое удаление — данные остаются в архиве)
    u_cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    for col, defn in [
        ('active', 'INTEGER DEFAULT 1'),
        ('password_hash', "TEXT DEFAULT ''"),
        ('must_change_password', 'INTEGER DEFAULT 1'),
        ('failed_login_attempts', 'INTEGER DEFAULT 0'),
        ('locked_until', 'TEXT'),
        ('last_login_at', 'TEXT'),
        ('password_changed_at', 'TEXT'),
    ]:
        if col not in u_cols:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} {defn}")
            conn.commit()

    # orders: add user_id, executor
    cols = [r[1] for r in conn.execute("PRAGMA table_info(orders)").fetchall()]
    for col, defn in [('user_id', 'INTEGER NOT NULL DEFAULT 1'), ('executor', "TEXT DEFAULT ''")]:
        if col not in cols:
            conn.execute(f"ALTER TABLE orders ADD COLUMN {col} {defn}")
            conn.commit()

    # software: add user_id, docx_filename
    cols = [r[1] for r in conn.execute("PRAGMA table_info(software)").fetchall()]
    for col, defn in [('user_id', 'INTEGER NOT NULL DEFAULT 1'), ('docx_filename', "TEXT DEFAULT ''")]:
        if col not in cols:
            conn.execute(f"ALTER TABLE software ADD COLUMN {col} {defn}")
            conn.commit()

    # articles: add user_id, docx_filename
    cols = [r[1] for r in conn.execute("PRAGMA table_info(articles)").fetchall()]
    for col, defn in [('user_id', 'INTEGER NOT NULL DEFAULT 1'), ('docx_filename', "TEXT DEFAULT ''")]:
        if col not in cols:
            conn.execute(f"ALTER TABLE articles ADD COLUMN {col} {defn}")
            conn.commit()

    # report_articles: add points_taken
    cols = [r[1] for r in conn.execute("PRAGMA table_info(report_articles)").fetchall()]
    if 'points_taken' not in cols:
        conn.execute("ALTER TABLE report_articles ADD COLUMN points_taken REAL DEFAULT 0")
        conn.commit()

    conn.commit()
    conn.close()
