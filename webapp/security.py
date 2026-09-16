# -*- coding: utf-8 -*-
"""共通ユーティリティ: 氏名の正規化、パスワードのハッシュ化、申請IDの採番。"""
import re
import unicodedata
from datetime import date, datetime, timedelta

from werkzeug.security import check_password_hash, generate_password_hash

from db import get_setting, set_setting

_WHITESPACE_RE = re.compile(r"\s+", re.UNICODE)


def normalize_name(raw_name: str) -> str:
    """氏名の桁揃え用スペース(半角・全角・タブ・改行など)をすべて取り除く。

    Excel版で「鈴木 正一」と「鈴木正一」が別人として扱われてしまう不具合を
    修正した経緯を踏まえ、最初からあらゆる空白文字を除去する設計にしている。
    """
    if raw_name is None:
        return ""
    s = unicodedata.normalize("NFKC", str(raw_name))
    return _WHITESPACE_RE.sub("", s).strip()


def hash_password(plain_password: str) -> str:
    return generate_password_hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    return check_password_hash(password_hash, plain_password)


def next_request_id(conn) -> str:
    n = int(get_setting(conn, "request_counter", "0")) + 1
    set_setting(conn, "request_counter", str(n))
    return f"REQ-{n:06d}"


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def date_range(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def month_start(d: date) -> date:
    return d.replace(day=1)


def days_in_month(d: date) -> int:
    if d.month == 12:
        nxt = d.replace(year=d.year + 1, month=1, day=1)
    else:
        nxt = d.replace(month=d.month + 1, day=1)
    return (nxt - d.replace(day=1)).days
