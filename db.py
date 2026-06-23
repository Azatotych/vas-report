import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
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
            created_at TEXT DEFAULT (datetime('now'))
        );

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
