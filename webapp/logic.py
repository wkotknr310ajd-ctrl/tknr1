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
from datetime import date, datetime

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
    """部署シフト表を職員×日付の2次元配列として返す。"""
    roster = conn.execute(
        "SELECT staff_name FROM roster WHERE department_id = ? ORDER BY sort_order, staff_name",
        (department_id,),
    ).fetchall()
    ndays = days_in_month(date(year, month, 1))
    cells = conn.execute(
        "SELECT staff_name, target_date, shift_code FROM shift_cells "
        "WHERE department_id = ? AND target_date >= ? AND target_date <= ?",
        (department_id, f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{ndays:02d}"),
    ).fetchall()
    by_name = {}
    for c in cells:
        by_name.setdefault(c["staff_name"], {})[c["target_date"]] = c["shift_code"]

    grid = []
    for r in roster:
        name = r["staff_name"]
        row_codes = []
        for d in range(1, ndays + 1):
            iso = f"{year:04d}-{month:02d}-{d:02d}"
            row_codes.append(by_name.get(name, {}).get(iso, ""))
        grid.append({"name": name, "codes": row_codes})
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
):
    conn.execute(
        "INSERT INTO history(request_id, applied_at, applicant, target_person, target_date, "
        "before_shift, after_shift, reason, status, approver, approved_at, original_request_id, kind) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                        reason_text, "申請中", "", None, "", "残業")
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
