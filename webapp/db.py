# -*- coding: utf-8 -*-
"""
勤務変更申請・承認システム(Webアプリ版)のデータベース定義・接続まわり。

SQLite 1ファイルにすべてのデータを保存する。テーブル構成は、Excel/VBA版で
すでに検証済みだった「履歴」シートの列構成・部署別シフト表の考え方を
そのまま踏襲している。
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "app.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT '一般',   -- '一般' or '一般・承認者'
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(department_id, staff_name)
);

CREATE TABLE IF NOT EXISTS shift_cells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    target_date TEXT NOT NULL,   -- ISO 'YYYY-MM-DD'
    shift_code TEXT NOT NULL DEFAULT '',
    UNIQUE(department_id, staff_name, target_date)
);

CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    applicant TEXT NOT NULL,
    target_person TEXT NOT NULL,
    target_date TEXT NOT NULL,
    before_shift TEXT NOT NULL DEFAULT '',
    after_shift TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    approver TEXT NOT NULL DEFAULT '',
    approved_at TEXT,
    original_request_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_shift_cells_dept_name ON shift_cells(department_id, staff_name);
CREATE INDEX IF NOT EXISTS idx_roster_staff_name ON roster(staff_name);
CREATE INDEX IF NOT EXISTS idx_history_request_id ON history(request_id);
CREATE INDEX IF NOT EXISTS idx_history_kind ON history(kind);
CREATE INDEX IF NOT EXISTS idx_history_status ON history(status);
"""

DEFAULT_DEPARTMENTS = ["入所", "上司", "通所", "事務局"]
DEFAULT_SETTINGS = {
    "target_month": "",       # 'YYYY-MM-01'
    "request_counter": "0",
    "leave_code": "年",
}


def get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    try:
        conn.executescript(SCHEMA)
        for i, name in enumerate(DEFAULT_DEPARTMENTS):
            conn.execute(
                "INSERT OR IGNORE INTO departments(name, sort_order) VALUES (?, ?)",
                (name, i),
            )
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v)
            )
        conn.commit()
    finally:
        conn.close()


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
