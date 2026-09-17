# -*- coding: utf-8 -*-
"""
勤務変更申請・承認システムの中核ロジック。

Excel/VBA版で検証済みだった設計をそのまま踏襲している:
- 申請者(誰が申請したか)と対象者(誰の勤務が変わるか)を別項目として記録する
- 交換申請・有給申請は「同一申請ID・履歴複数行」として登録し、承認・却下・
  ロールバックはすべて「同じ申請IDに紐づく行をまとめて処理する」共通ロジックで扱う
- 承認・ロールバックの直前に、シフト表の実際の値と履歴上の期待値を突き合わせ、
  食い違いがあれば警告メッセージを返す(処理は続行する)
"""
import sqlite3
from datetime import date, datetime

import db
from security import (
    date_range,
    days_in_month,
    hash_password,
    next_request_id,
    normalize_name,
    now_iso,
    verify_password,
)


class AppError(Exception):
    """ユーザーへそのまま表示してよいエラーメッセージ。"""


# ------------------------------------------------------------------
# 職員マスタ
# ------------------------------------------------------------------
def find_staff(conn, name: str):
    name = normalize_name(name)
    return conn.execute("SELECT * FROM staff WHERE name = ?", (name,)).fetchone()


def register_staff(conn, name: str, password: str, is_approver: bool):
    name = normalize_name(name)
    if not name:
        raise AppError("氏名を入力してください。")
    if find_staff(conn, name):
        raise AppError("同じ氏名が既に登録されています。")
    role = "一般・承認者" if is_approver else "一般"
    conn.execute(
        "INSERT INTO staff(name, role, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (name, role, hash_password(password), now_iso()),
    )
    conn.commit()


def rename_staff(conn, old_name: str, new_name: str):
    """入力ミスなどで登録した氏名を訂正する。シフト表・履歴上の同じ名前もすべて置き換える。"""
    old_name = normalize_name(old_name)
    new_name = normalize_name(new_name)
    if not new_name:
        raise AppError("新しい氏名を入力してください。")
    staff = find_staff(conn, old_name)
    if not staff:
        raise AppError("職員マスタに見つかりません。")
    if new_name != old_name and find_staff(conn, new_name):
        raise AppError("その氏名はすでに登録されています。")
    try:
        conn.execute("UPDATE staff SET name = ? WHERE id = ?", (new_name, staff["id"]))
        conn.execute("UPDATE roster SET staff_name = ? WHERE staff_name = ?", (new_name, old_name))
        conn.execute("UPDATE shift_cells SET staff_name = ? WHERE staff_name = ?", (new_name, old_name))
        conn.execute("UPDATE history SET applicant = ? WHERE applicant = ?", (new_name, old_name))
        conn.execute("UPDATE history SET target_person = ? WHERE target_person = ?", (new_name, old_name))
    except sqlite3.IntegrityError:
        conn.rollback()
        raise AppError("その氏名はシフト表内で重複するため変更できません。")
    conn.commit()


def delete_staff(conn, name: str):
    """誤って登録した職員を職員マスタから削除する。シフト表・履歴の記録は残す。"""
    name = normalize_name(name)
    staff = find_staff(conn, name)
    if not staff:
        raise AppError("職員マスタに見つかりません。")
    conn.execute("DELETE FROM staff WHERE id = ?", (staff["id"],))
    conn.execute("DELETE FROM roster WHERE staff_name = ?", (name,))
    conn.commit()


# ------------------------------------------------------------------
# 管理画面のパスワード
# ------------------------------------------------------------------
DEFAULT_ADMIN_PASSWORD = "admin1234"


def ensure_default_admin_password(conn):
    """管理パスワードが未設定の場合、初期パスワードを設定する。"""
    if not db.get_setting(conn, "admin_password_hash"):
        db.set_setting(conn, "admin_password_hash", hash_password(DEFAULT_ADMIN_PASSWORD))
        conn.commit()


def verify_admin_password(conn, password: str) -> bool:
    return verify_password(password, db.get_setting(conn, "admin_password_hash", ""))


def change_admin_password(conn, current_password: str, new_password: str):
    if not verify_admin_password(conn, current_password):
        raise AppError("現在の管理パスワードが正しくありません。")
    if not new_password:
        raise AppError("新しいパスワードを入力してください。")
    db.set_setting(conn, "admin_password_hash", hash_password(new_password))
    conn.commit()


def change_password(conn, name: str, old_password: str, new_password: str):
    staff = find_staff(conn, name)
    if not staff:
        raise AppError("職員マスタに見つかりません。")
    if not verify_password(old_password, staff["password_hash"]):
        raise AppError("現在のパスワードが正しくありません。")
    conn.execute(
        "UPDATE staff SET password_hash = ? WHERE id = ?",
        (hash_password(new_password), staff["id"]),
    )
    conn.commit()


def authenticate(conn, name: str, password: str, require_approver: bool = False):
    staff = find_staff(conn, name)
    if not staff:
        raise AppError(f"{name} は職員マスタに登録されていません。管理者に確認してください。")
    if not verify_password(password, staff["password_hash"]):
        raise AppError("パスワードが正しくありません。")
    if require_approver and "承認者" not in staff["role"]:
        raise AppError(f"{name} には承認権限がありません。")
    return staff


# ------------------------------------------------------------------
# 部署・シフト表
# ------------------------------------------------------------------
def list_departments(conn):
    return conn.execute("SELECT * FROM departments ORDER BY sort_order, id").fetchall()


def get_department(conn, department_id):
    return conn.execute("SELECT * FROM departments WHERE id = ?", (department_id,)).fetchone()


def find_roster_department(conn, staff_name: str):
    """氏名から所属部署を探す(全部署のロースターを横断検索)。見つからなければNone。"""
    name = normalize_name(staff_name)
    row = conn.execute(
        "SELECT department_id FROM roster WHERE staff_name = ?", (name,)
    ).fetchone()
    return row["department_id"] if row else None


def ensure_roster(conn, department_id, staff_name: str):
    name = normalize_name(staff_name)
    conn.execute(
        "INSERT OR IGNORE INTO roster(department_id, staff_name) VALUES (?, ?)",
        (department_id, name),
    )


def get_shift_code(conn, department_id, staff_name: str, target_date_iso: str) -> str:
    name = normalize_name(staff_name)
    row = conn.execute(
        "SELECT shift_code FROM shift_cells WHERE department_id=? AND staff_name=? AND target_date=?",
        (department_id, name, target_date_iso),
    ).fetchone()
    return row["shift_code"] if row else ""


def set_shift_code(conn, department_id, staff_name: str, target_date_iso: str, shift_code: str):
    name = normalize_name(staff_name)
    conn.execute(
        "INSERT INTO shift_cells(department_id, staff_name, target_date, shift_code) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(department_id, staff_name, target_date) DO UPDATE SET shift_code=excluded.shift_code",
        (department_id, name, target_date_iso, shift_code),
    )


def get_current_shift(conn, staff_name: str, target_date_iso: str):
    """氏名と日付から、所属部署のシフト表を自動的に探して現在の勤務内容を返す。
    (department_id, shift_code) を返す。所属部署が見つからない場合は (None, '')。"""
    dept_id = find_roster_department(conn, staff_name)
    if dept_id is None:
        return None, ""
    return dept_id, get_shift_code(conn, dept_id, staff_name, target_date_iso)


def department_shift_grid(conn, department_id, year: int, month: int):
    """部署シフト表を職員×日付の2次元配列として返す。承認済みの変更で書き換わったセルには
    changed フラグを立てて、シフト表の画面で色分け表示できるようにする。"""
    roster = conn.execute(
        "SELECT staff_name FROM roster WHERE department_id = ? ORDER BY sort_order, staff_name",
        (department_id,),
    ).fetchall()
    ndays = days_in_month(date(year, month, 1))
    month_start_iso = f"{year:04d}-{month:02d}-01"
    month_end_iso = f"{year:04d}-{month:02d}-{ndays:02d}"
    cells = conn.execute(
        "SELECT staff_name, target_date, shift_code FROM shift_cells "
        "WHERE department_id = ? AND target_date >= ? AND target_date <= ?",
        (department_id, month_start_iso, month_end_iso),
    ).fetchall()
    by_name = {}
    for c in cells:
        by_name.setdefault(c["staff_name"], {})[c["target_date"]] = c["shift_code"]

    changed_rows = conn.execute(
        "SELECT DISTINCT target_person, target_date FROM history "
        "WHERE status = '承認' AND target_date >= ? AND target_date <= ?",
        (month_start_iso, month_end_iso),
    ).fetchall()
    changed = {(r["target_person"], r["target_date"]) for r in changed_rows}

    grid = []
    for r in roster:
        name = r["staff_name"]
        row_cells = []
        for d in range(1, ndays + 1):
            iso = f"{year:04d}-{month:02d}-{d:02d}"
            row_cells.append({
                "date": iso,
                "code": by_name.get(name, {}).get(iso, ""),
                "changed": (name, iso) in changed,
            })
        grid.append({"name": name, "codes": row_cells})
    return grid, ndays


# ------------------------------------------------------------------
# 履歴
# ------------------------------------------------------------------
def append_history_row(
    conn,
    request_id,
    applicant,
    target_person,
    target_date_iso,
    before_shift,
    after_shift,
    reason,
    status,
    approver,
    approved_at,
    original_request_id,
    kind,
    overtime_minutes=0,
):
    conn.execute(
        "INSERT INTO history(request_id, applied_at, applicant, target_person, target_date, "
        "before_shift, after_shift, reason, status, approver, approved_at, original_request_id, kind, "
        "overtime_minutes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            request_id,
            now_iso(),
            normalize_name(applicant),
            normalize_name(target_person),
            target_date_iso,
            before_shift,
            after_shift,
            reason,
            status,
            normalize_name(approver) if approver else "",
            approved_at,
            original_request_id or "",
            kind,
            overtime_minutes,
        ),
    )


def find_history_rows(conn, request_id):
    return conn.execute(
        "SELECT * FROM history WHERE request_id = ? ORDER BY id", (request_id,)
    ).fetchall()


def list_pending(conn):
    return conn.execute(
        "SELECT * FROM history WHERE status = '申請中' ORDER BY id"
    ).fetchall()


def list_approved(conn):
    return conn.execute(
        "SELECT * FROM history WHERE status = '承認' ORDER BY id"
    ).fetchall()


def list_history(conn, kinds=None):
    if kinds:
        placeholders = ",".join("?" * len(kinds))
        return conn.execute(
            f"SELECT * FROM history WHERE kind IN ({placeholders}) ORDER BY id DESC",
            kinds,
        ).fetchall()
    return conn.execute("SELECT * FROM history ORDER BY id DESC").fetchall()


# ------------------------------------------------------------------
# 申請
# ------------------------------------------------------------------
def submit_single_request(conn, applicant, password, target_date_iso, new_shift, reason):
    applicant = normalize_name(applicant)
    authenticate(conn, applicant, password)

    dept_id, current_shift = get_current_shift(conn, applicant, target_date_iso)
    if dept_id is None:
        raise AppError(f"シフト表に {applicant} の行が見つかりません。管理者に確認してください。")
    if current_shift == new_shift:
        raise AppError("変更前と変更後の内容が同じです。")

    req_id = next_request_id(conn)
    append_history_row(
        conn, req_id, applicant, applicant, target_date_iso, current_shift, new_shift,
        reason, "申請中", "", None, "", "勤務変更",
    )
    conn.commit()
    return req_id, current_shift


def submit_swap_request(conn, applicant, password, name_a, date_a_iso, new_shift_a,
                         name_b, date_b_iso, new_shift_b, reason):
    applicant = normalize_name(applicant)
    authenticate(conn, applicant, password)

    name_a = normalize_name(name_a)
    name_b = normalize_name(name_b)
    if not name_a or not name_b:
        raise AppError("対象者A・対象者Bの氏名を入力してください。")
    if name_a == name_b and date_a_iso == date_b_iso:
        raise AppError("対象者Aと対象者Bが同一人物・同一日です。異なる組み合わせを指定してください。")
    if not find_staff(conn, name_a):
        raise AppError(f"{name_a} は職員マスタに登録されていません。管理者に確認してください。")
    if not find_staff(conn, name_b):
        raise AppError(f"{name_b} は職員マスタに登録されていません。管理者に確認してください。")

    dept_a, current_a = get_current_shift(conn, name_a, date_a_iso)
    if dept_a is None:
        raise AppError(f"シフト表に {name_a} の行が見つかりません。")
    dept_b, current_b = get_current_shift(conn, name_b, date_b_iso)
    if dept_b is None:
        raise AppError(f"シフト表に {name_b} の行が見つかりません。")

    req_id = next_request_id(conn)
    reason_a = f"【交換申請】相手: {name_b}({date_b_iso[5:].replace('-', '/')}) {reason}"
    reason_b = f"【交換申請】相手: {name_a}({date_a_iso[5:].replace('-', '/')}) {reason}"
    append_history_row(conn, req_id, applicant, name_a, date_a_iso, current_a, new_shift_a,
                        reason_a, "申請中", "", None, "", "勤務交換")
    append_history_row(conn, req_id, applicant, name_b, date_b_iso, current_b, new_shift_b,
                        reason_b, "申請中", "", None, "", "勤務交換")
    conn.commit()
    return req_id, current_a, current_b


def submit_leave_request(conn, applicant, password, start_iso, end_iso, reason, leave_code):
    applicant = normalize_name(applicant)
    authenticate(conn, applicant, password)

    start_d = datetime.strptime(start_iso, "%Y-%m-%d").date()
    end_d = datetime.strptime(end_iso, "%Y-%m-%d").date()
    if end_d < start_d:
        raise AppError("終了日は開始日以降にしてください。")
    if (end_d - start_d).days > 30:
        raise AppError("一度に申請できるのは31日分までです。期間を分けて申請してください。")

    dept_id = find_roster_department(conn, applicant)
    if dept_id is None:
        raise AppError(f"シフト表に {applicant} の行が見つかりません。管理者に確認してください。")

    req_id = next_request_id(conn)
    summary = []
    for d in date_range(start_d, end_d):
        iso = d.strftime("%Y-%m-%d")
        current_shift = get_shift_code(conn, dept_id, applicant, iso)
        reason_text = f"【有給申請】{start_iso[5:].replace('-', '/')}〜{end_iso[5:].replace('-', '/')} {reason}"
        append_history_row(conn, req_id, applicant, applicant, iso, current_shift, leave_code,
                            reason_text, "申請中", "", None, "", "有給")
        summary.append((iso, current_shift, leave_code))
    conn.commit()
    return req_id, summary


def submit_overtime_request(conn, applicant, password, target_date_iso, start_time, end_time, reason):
    applicant = normalize_name(applicant)
    authenticate(conn, applicant, password)

    fmt = "%H:%M"
    t_start = datetime.strptime(start_time, fmt)
    t_end = datetime.strptime(end_time, fmt)
    diff_minutes = (t_end - t_start).total_seconds() / 60
    if diff_minutes <= 0:
        diff_minutes += 24 * 60
    if diff_minutes > 12 * 60:
        raise AppError("開始時刻・終了時刻を確認してください(12時間を超える入力はできません)。")
    if diff_minutes <= 0:
        raise AppError("開始時刻・終了時刻を確認してください。")

    hours = int(diff_minutes) // 60
    mins = int(diff_minutes) % 60
    hours_label = f"{hours}時間" + (f"{mins}分" if mins else "")

    dept_id, current_shift = get_current_shift(conn, applicant, target_date_iso)
    if dept_id is None:
        raise AppError(f"シフト表に {applicant} の行が見つかりません。管理者に確認してください。")

    new_shift = f"{current_shift}(残{hours_label})"
    req_id = next_request_id(conn)
    reason_text = f"【超過勤務申請】{start_time}〜{end_time}({hours_label}) {reason}"
    append_history_row(conn, req_id, applicant, applicant, target_date_iso, current_shift, new_shift,
                        reason_text, "申請中", "", None, "", "残業", overtime_minutes=int(diff_minutes))
    conn.commit()
    return req_id, current_shift, new_shift, hours_label


# ------------------------------------------------------------------
# 承認・却下
# ------------------------------------------------------------------
def process_approval(conn, request_id, approver_name, approver_password, decision):
    approver = authenticate(conn, approver_name, approver_password, require_approver=True)
    approver_name = approver["name"]

    rows = find_history_rows(conn, request_id)
    if not rows:
        raise AppError("対象の申請が見つかりません。既に処理済みの可能性があります。")
    for row in rows:
        if row["status"] != "申請中":
            raise AppError("この申請は既に処理済みです。")

    if decision == "却下":
        conn.execute(
            "UPDATE history SET status='却下', approver=?, approved_at=? WHERE request_id=?",
            (approver_name, now_iso(), request_id),
        )
        conn.commit()
        return "却下しました。", []

    warnings = []
    plan = []
    for row in rows:
        dept_id = find_roster_department(conn, row["target_person"])
        if dept_id is None:
            raise AppError(f"シフト表の対象セルが見つかりません({row['target_person']})。管理者に確認してください。")
        actual_current = get_shift_code(conn, dept_id, row["target_person"], row["target_date"])
        if actual_current != row["before_shift"]:
            warnings.append(
                f"{row['target_person']}({row['target_date']}): 現在「{actual_current}」/ "
                f"申請時の前提「{row['before_shift']}」"
            )
        plan.append((dept_id, row))

    for dept_id, row in plan:
        set_shift_code(conn, dept_id, row["target_person"], row["target_date"], row["after_shift"])

    conn.execute(
        "UPDATE history SET status='承認', approver=?, approved_at=? WHERE request_id=?",
        (approver_name, now_iso(), request_id),
    )
    conn.commit()
    return f"承認しました。シフト表に反映しました。({len(rows)}件)", warnings


def process_rollback(conn, request_id, approver_name, approver_password):
    approver = authenticate(conn, approver_name, approver_password, require_approver=True)
    approver_name = approver["name"]

    rows = find_history_rows(conn, request_id)
    if not rows:
        raise AppError("対象の申請が見つかりません。")
    for row in rows:
        if row["status"] != "承認":
            raise AppError("承認済みの申請のみ取り消せます。")

    warnings = []
    plan = []
    for row in rows:
        dept_id = find_roster_department(conn, row["target_person"])
        if dept_id is None:
            raise AppError(f"シフト表の対象セルが見つかりません({row['target_person']})。")
        actual_current = get_shift_code(conn, dept_id, row["target_person"], row["target_date"])
        if actual_current != row["after_shift"]:
            warnings.append(
                f"{row['target_person']}({row['target_date']}): 現在「{actual_current}」/ "
                f"承認時の反映値「{row['after_shift']}」"
            )
        plan.append((dept_id, row))

    new_id = next_request_id(conn)
    for dept_id, row in plan:
        set_shift_code(conn, dept_id, row["target_person"], row["target_date"], row["before_shift"])

    conn.execute(
        "UPDATE history SET status='取消(ロールバック)' WHERE request_id=?", (request_id,)
    )
    for row in rows:
        append_history_row(
            conn, new_id, approver_name, row["target_person"], row["target_date"],
            row["after_shift"], row["before_shift"],
            f"ロールバックによる取消(元申請: {request_id})", "取消完了", approver_name, now_iso(),
            request_id, row["kind"],
        )
    conn.commit()
    return f"取り消しました。シフト表を元の状態に戻しました。({len(rows)}件)", warnings


# ------------------------------------------------------------------
# 月初めの切り替え
# ------------------------------------------------------------------
def start_new_month(conn, new_month_iso: str):
    """職員マスタ(氏名・パスワード)・履歴はそのまま残し、部署のロースターと
    シフト表の中身だけをすべて消去して、新しい対象年月に切り替える。"""
    from db import set_setting

    conn.execute("DELETE FROM shift_cells")
    conn.execute("DELETE FROM roster")
    set_setting(conn, "target_month", new_month_iso)
    conn.commit()


# ------------------------------------------------------------------
# 有給・残業の集計
# ------------------------------------------------------------------
def fiscal_year_bounds(today: date, start_month: int):
    """指定した日付が含まれる年度(start_month始まり)の開始日・終了日を返す。"""
    if today.month >= start_month:
        fy_start = date(today.year, start_month, 1)
    else:
        fy_start = date(today.year - 1, start_month, 1)
    if start_month == 1:
        fy_end = date(fy_start.year, 12, 31)
    else:
        end_year = fy_start.year + 1
        end_month = start_month - 1
        fy_end = date(end_year, end_month, days_in_month(date(end_year, end_month, 1)))
    return fy_start, fy_end


def leave_summary(conn, today=None):
    """職員ごとの当年度の有給取得日数・残り日数を返す。承認済み(取消されていない)分のみ数える。
    職員ごとに個別の上限日数(staff.leave_annual_limit_days)が設定されていればそちらを使い、
    未設定であれば全体の初期値(leave_annual_limit_days設定)を使う。"""
    today = today or date.today()
    start_month = int(db.get_setting(conn, "fiscal_year_start_month", "4"))
    default_limit_days = float(db.get_setting(conn, "leave_annual_limit_days", "40"))
    fy_start, fy_end = fiscal_year_bounds(today, start_month)

    rows = conn.execute(
        "SELECT target_person, COUNT(DISTINCT target_date) AS days FROM history "
        "WHERE kind = '有給' AND status = '承認' AND target_date >= ? AND target_date <= ? "
        "GROUP BY target_person",
        (fy_start.isoformat(), fy_end.isoformat()),
    ).fetchall()
    taken_by_name = {r["target_person"]: r["days"] for r in rows}

    staff = conn.execute(
        "SELECT name, leave_annual_limit_days FROM staff ORDER BY name"
    ).fetchall()
    result = []
    for s in staff:
        taken = taken_by_name.get(s["name"], 0)
        custom_limit = s["leave_annual_limit_days"]
        limit_days = custom_limit if custom_limit is not None else default_limit_days
        result.append({
            "name": s["name"],
            "taken_days": taken,
            "limit_days": limit_days,
            "is_custom_limit": custom_limit is not None,
            "remaining_days": limit_days - taken,
            "over_limit": taken > limit_days,
        })
    return result, fy_start, fy_end, default_limit_days


def set_staff_leave_limit(conn, name: str, limit_days):
    """職員ごとの有給年間上限日数を個別設定する。limit_daysにNoneを渡すと、
    全体の初期値を使う設定(個別設定なし)に戻る。"""
    name = normalize_name(name)
    staff = find_staff(conn, name)
    if not staff:
        raise AppError("職員マスタに見つかりません。")
    conn.execute(
        "UPDATE staff SET leave_annual_limit_days = ? WHERE id = ?",
        (limit_days, staff["id"]),
    )
    conn.commit()


def overtime_summary(conn, today=None):
    """職員ごとの当年度の残業時間を月別に集計する。承認済み(取消されていない)分のみ数える。"""
    today = today or date.today()
    start_month = int(db.get_setting(conn, "fiscal_year_start_month", "4"))
    month_limit = float(db.get_setting(conn, "overtime_month_limit_hours", "45"))
    year_limit = float(db.get_setting(conn, "overtime_year_limit_hours", "360"))
    fy_start, fy_end = fiscal_year_bounds(today, start_month)

    months = []
    y, m = fy_start.year, fy_start.month
    for _ in range(12):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1

    rows = conn.execute(
        "SELECT target_person, target_date, overtime_minutes FROM history "
        "WHERE kind = '残業' AND status = '承認' AND target_date >= ? AND target_date <= ?",
        (fy_start.isoformat(), fy_end.isoformat()),
    ).fetchall()

    minutes_by_name_month = {}
    for r in rows:
        y2, m2 = int(r["target_date"][:4]), int(r["target_date"][5:7])
        by_month = minutes_by_name_month.setdefault(r["target_person"], {})
        by_month[(y2, m2)] = by_month.get((y2, m2), 0) + r["overtime_minutes"]

    staff = conn.execute("SELECT name FROM staff ORDER BY name").fetchall()
    result = []
    for s in staff:
        by_month = minutes_by_name_month.get(s["name"], {})
        month_hours = [round(by_month.get(ym, 0) / 60, 2) for ym in months]
        year_hours = round(sum(by_month.values()) / 60, 2)
        result.append({
            "name": s["name"],
            "month_hours": month_hours,
            "year_hours": year_hours,
            "over_year_limit": year_hours > year_limit,
        })
    return result, months, fy_start, fy_end, month_limit, year_limit
