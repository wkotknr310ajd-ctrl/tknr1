# -*- coding: utf-8 -*-
"""勤務変更申請・承認システム(Webアプリ版)のエントリポイント。"""
import uuid
from datetime import date, datetime
from pathlib import Path

from flask import Flask, flash, g, jsonify, redirect, render_template, request, session, url_for

import db
import excel_import
import logic
from security import days_in_month, month_start, normalize_name

app = Flask(__name__)
app.secret_key = "shift-change-system-local-secret"  # 社内LAN限定運用のための簡易な値

IMPORT_DIR = Path(__file__).parent / "data" / "imports"


def get_db():
    if "db" not in g:
        g.db = db.get_conn()
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


ADMIN_LOGIN_EXEMPT_ENDPOINTS = {"admin_login", "static"}


@app.before_request
def require_admin_login():
    if request.path.startswith("/admin") and request.endpoint not in ADMIN_LOGIN_EXEMPT_ENDPOINTS:
        if not session.get("admin_authed"):
            return redirect(url_for("admin_login", next=request.path))
    return None


@app.template_filter("fmtdate")
def fmt_date(value):
    if not value:
        return ""
    return str(value).replace("-", "/")


def current_target_month():
    conn = get_db()
    raw = db.get_setting(conn, "target_month", "")
    if raw:
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            pass
    return month_start(date.today())


@app.context_processor
def inject_globals():
    conn = get_db()
    tm = current_target_month()
    return {
        "nav_departments": logic.list_departments(conn),
        "target_month": f"{tm.year}年{tm.month}月",
    }


@app.route("/")
def index():
    conn = get_db()
    return render_template(
        "index.html",
        pending_count=len(logic.list_pending(conn)),
        target_month_date=current_target_month(),
    )


# ------------------------------------------------------------------
# 単独の勤務変更
# ------------------------------------------------------------------
@app.route("/request", methods=["GET", "POST"])
def request_single():
    conn = get_db()
    if request.method == "POST":
        try:
            req_id, before = logic.submit_single_request(
                conn,
                request.form["applicant"],
                request.form["password"],
                request.form["target_date"],
                request.form["new_shift"].strip(),
                request.form.get("reason", "").strip(),
            )
            flash(f"申請を受け付けました。(申請ID: {req_id}) {before} → "
                  f"{request.form['new_shift'].strip()}。上司の承認をお待ちください。", "success")
            return redirect(url_for("request_single"))
        except logic.AppError as e:
            flash(str(e), "error")
    return render_template("request_single.html", staff_list=list_staff_names(conn))


@app.route("/api/current_shift")
def api_current_shift():
    conn = get_db()
    name = request.args.get("name", "")
    target_date = request.args.get("date", "")
    if not name or not target_date:
        return jsonify({"shift": "-"})
    _, shift = logic.get_current_shift(conn, name, target_date)
    return jsonify({"shift": shift if shift else "(未設定)"})


# ------------------------------------------------------------------
# 2名間の勤務交換
# ------------------------------------------------------------------
@app.route("/swap", methods=["GET", "POST"])
def request_swap():
    conn = get_db()
    if request.method == "POST":
        try:
            req_id, cur_a, cur_b = logic.submit_swap_request(
                conn,
                request.form["applicant"],
                request.form["password"],
                request.form["name_a"],
                request.form["date_a"],
                request.form["new_shift_a"].strip(),
                request.form["name_b"],
                request.form["date_b"],
                request.form["new_shift_b"].strip(),
                request.form.get("reason", "").strip(),
            )
            flash(f"交換申請を受け付けました。(申請ID: {req_id})", "success")
            return redirect(url_for("request_swap"))
        except logic.AppError as e:
            flash(str(e), "error")
    return render_template("request_swap.html", staff_list=list_staff_names(conn))


# ------------------------------------------------------------------
# 有給休暇申請
# ------------------------------------------------------------------
@app.route("/leave", methods=["GET", "POST"])
def request_leave():
    conn = get_db()
    if request.method == "POST":
        try:
            leave_code = db.get_setting(conn, "leave_code", "年")
            req_id, summary = logic.submit_leave_request(
                conn,
                request.form["applicant"],
                request.form["password"],
                request.form["start_date"],
                request.form["end_date"],
                request.form.get("reason", "").strip(),
                leave_code,
            )
            flash(f"有給申請を受け付けました。(申請ID: {req_id}、{len(summary)}日分)", "success")
            return redirect(url_for("request_leave"))
        except logic.AppError as e:
            flash(str(e), "error")
    return render_template("request_leave.html", staff_list=list_staff_names(conn))


# ------------------------------------------------------------------
# 超過勤務申請
# ------------------------------------------------------------------
@app.route("/overtime", methods=["GET", "POST"])
def request_overtime():
    conn = get_db()
    if request.method == "POST":
        try:
            req_id, current, new_shift, hours_label = logic.submit_overtime_request(
                conn,
                request.form["applicant"],
                request.form["password"],
                request.form["target_date"],
                request.form["start_time"],
                request.form["end_time"],
                request.form.get("reason", "").strip(),
            )
            flash(f"超過勤務申請を受け付けました。(申請ID: {req_id}) {current} → {new_shift}", "success")
            return redirect(url_for("request_overtime"))
        except logic.AppError as e:
            flash(str(e), "error")
    return render_template("request_overtime.html", staff_list=list_staff_names(conn))


# ------------------------------------------------------------------
# 承認
# ------------------------------------------------------------------
@app.route("/approve", methods=["GET", "POST"])
def approve():
    conn = get_db()
    if request.method == "POST":
        try:
            message, warnings = logic.process_approval(
                conn,
                request.form["request_id"],
                request.form["approver"],
                request.form["password"],
                request.form["decision"],
            )
            for w in warnings:
                flash(f"注意: {w}", "warning")
            flash(message, "success")
            return redirect(url_for("approve"))
        except logic.AppError as e:
            flash(str(e), "error")
    pending = logic.list_pending(conn)
    pending_ids = list(dict.fromkeys(r["request_id"] for r in pending))
    return render_template("approve.html", pending=pending, pending_ids=pending_ids,
                            staff_list=list_staff_names(conn, approvers_only=True))


# ------------------------------------------------------------------
# ロールバック
# ------------------------------------------------------------------
@app.route("/rollback", methods=["GET", "POST"])
def rollback():
    conn = get_db()
    if request.method == "POST":
        try:
            message, warnings = logic.process_rollback(
                conn,
                request.form["request_id"],
                request.form["approver"],
                request.form["password"],
            )
            for w in warnings:
                flash(f"注意: {w}", "warning")
            flash(message, "success")
            return redirect(url_for("rollback"))
        except logic.AppError as e:
            flash(str(e), "error")
    approved = logic.list_approved(conn)
    approved_ids = list(dict.fromkeys(r["request_id"] for r in approved))
    return render_template("rollback.html", approved=approved, approved_ids=approved_ids,
                            staff_list=list_staff_names(conn, approvers_only=True))


# ------------------------------------------------------------------
# 履歴
# ------------------------------------------------------------------
KIND_GROUPS = {
    "all": None,
    "shift": ["勤務変更", "勤務交換"],
    "leave": ["有給"],
    "overtime": ["残業"],
}


@app.route("/history")
def history():
    conn = get_db()
    group = request.args.get("kind", "all")
    kinds = KIND_GROUPS.get(group)
    rows = logic.list_history(conn, kinds)
    return render_template("history.html", rows=rows, group=group)


@app.route("/history/export")
def history_export():
    conn = get_db()
    group = request.args.get("kind", "all")
    kinds = KIND_GROUPS.get(group)
    rows = logic.list_history(conn, kinds)

    from io import BytesIO

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "履歴"
    headers = [
        "申請ID", "登録日時", "種別", "状態", "申請者", "対象者", "対象日",
        "変更前", "変更後", "理由", "承認者", "承認日時", "元申請ID",
    ]
    ws.append(headers)
    for r in rows:
        ws.append([
            r["request_id"], r["applied_at"], r["kind"], r["status"],
            r["applicant"], r["target_person"], r["target_date"],
            r["before_shift"], r["after_shift"], r["reason"],
            r["approver"], r["approved_at"] or "", r["original_request_id"],
        ])
    for col_idx in range(1, len(headers) + 1):
        ws.column_dimensions[chr(64 + col_idx) if col_idx <= 26 else "A"].width = 16

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"history_{group}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return app.response_class(
        buf.read(),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ------------------------------------------------------------------
# シフト表閲覧
# ------------------------------------------------------------------
@app.route("/shift/<int:department_id>")
def shift_table(department_id):
    conn = get_db()
    dept = logic.get_department(conn, department_id)
    if not dept:
        flash("部署が見つかりません。", "error")
        return redirect(url_for("index"))
    tm = current_target_month()
    grid, ndays = logic.department_shift_grid(conn, department_id, tm.year, tm.month)
    return render_template(
        "shift_table.html", dept=dept, grid=grid, ndays=ndays, target_month_date=tm,
        departments=logic.list_departments(conn),
    )


# ------------------------------------------------------------------
# 管理(パスワードによる保護)
# ------------------------------------------------------------------
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    conn = get_db()
    next_url = request.values.get("next") or url_for("admin")
    if request.method == "POST":
        if logic.verify_admin_password(conn, request.form.get("password", "")):
            session["admin_authed"] = True
            return redirect(request.form.get("next") or url_for("admin"))
        flash("パスワードが正しくありません。", "error")
    return render_template("admin_login.html", next_url=next_url)


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("admin_authed", None)
    flash("管理画面からログアウトしました。", "success")
    return redirect(url_for("index"))


@app.route("/admin/change_password", methods=["POST"])
def admin_change_password():
    conn = get_db()
    try:
        logic.change_admin_password(conn, request.form["current_password"], request.form["new_password"])
        flash("管理パスワードを変更しました。", "success")
    except logic.AppError as e:
        flash(str(e), "error")
    return redirect(url_for("admin"))


# ------------------------------------------------------------------
# 管理
# ------------------------------------------------------------------
@app.route("/admin", methods=["GET"])
def admin():
    conn = get_db()
    return render_template(
        "admin.html",
        staff=conn.execute("SELECT * FROM staff ORDER BY name").fetchall(),
        departments=logic.list_departments(conn),
        target_month_date=current_target_month(),
        leave_code=db.get_setting(conn, "leave_code", "年"),
    )


@app.route("/admin/summary", methods=["GET"])
def admin_summary():
    conn = get_db()
    leave_rows, leave_fy_start, leave_fy_end, leave_limit = logic.leave_summary(conn)
    overtime_rows, months, ot_fy_start, ot_fy_end, month_limit, year_limit = logic.overtime_summary(conn)
    return render_template(
        "admin_summary.html",
        leave_rows=leave_rows,
        leave_fy_start=leave_fy_start,
        leave_fy_end=leave_fy_end,
        leave_limit=leave_limit,
        overtime_rows=overtime_rows,
        months=months,
        ot_fy_start=ot_fy_start,
        ot_fy_end=ot_fy_end,
        month_limit=month_limit,
        year_limit=year_limit,
    )


@app.route("/admin/limits", methods=["POST"])
def admin_set_limits():
    conn = get_db()
    try:
        fiscal_month = int(request.form["fiscal_year_start_month"])
        leave_limit = float(request.form["leave_annual_limit_days"])
        month_limit = float(request.form["overtime_month_limit_hours"])
        year_limit = float(request.form["overtime_year_limit_hours"])
        if not (1 <= fiscal_month <= 12):
            raise ValueError("年度の開始月は1〜12で指定してください。")
    except (KeyError, ValueError):
        flash("数値を正しく入力してください。", "error")
        return redirect(url_for("admin_summary"))
    db.set_setting(conn, "fiscal_year_start_month", str(fiscal_month))
    db.set_setting(conn, "leave_annual_limit_days", str(leave_limit))
    db.set_setting(conn, "overtime_month_limit_hours", str(month_limit))
    db.set_setting(conn, "overtime_year_limit_hours", str(year_limit))
    conn.commit()
    flash("上限の設定を更新しました。", "success")
    return redirect(url_for("admin_summary"))


@app.route("/admin/staff/leave_limit", methods=["POST"])
def admin_set_staff_leave_limit():
    conn = get_db()
    name = request.form.get("name", "")
    raw = request.form.get("limit_days", "").strip()
    try:
        limit_days = float(raw) if raw != "" else None
        logic.set_staff_leave_limit(conn, name, limit_days)
        flash(f"{normalize_name(name)} さんの有給上限を更新しました。", "success")
    except (ValueError, logic.AppError) as e:
        flash(str(e) if isinstance(e, logic.AppError) else "上限日数を正しく入力してください。", "error")
    return redirect(url_for("admin_summary"))


@app.route("/admin/staff", methods=["POST"])
def admin_register_staff():
    conn = get_db()
    try:
        logic.register_staff(
            conn,
            request.form["name"],
            request.form["password"],
            request.form.get("is_approver") == "on",
        )
        flash(f"{normalize_name(request.form['name'])} さんを登録しました。", "success")
    except logic.AppError as e:
        flash(str(e), "error")
    return redirect(url_for("admin"))


@app.route("/admin/staff/rename", methods=["POST"])
def admin_rename_staff():
    conn = get_db()
    try:
        old_name = request.form["old_name"]
        new_name = request.form["new_name"]
        logic.rename_staff(conn, old_name, new_name)
        flash(f"{normalize_name(old_name)} さんの氏名を {normalize_name(new_name)} に変更しました。", "success")
    except logic.AppError as e:
        flash(str(e), "error")
    return redirect(url_for("admin"))


@app.route("/admin/staff/delete", methods=["POST"])
def admin_delete_staff():
    conn = get_db()
    try:
        name = request.form["name"]
        logic.delete_staff(conn, name)
        flash(f"{normalize_name(name)} さんを職員マスタから削除しました。", "success")
    except logic.AppError as e:
        flash(str(e), "error")
    return redirect(url_for("admin"))


@app.route("/admin/import", methods=["GET"])
def admin_import():
    conn = get_db()
    return render_template("admin_import.html", departments=logic.list_departments(conn))


@app.route("/admin/import/preview", methods=["POST"])
def admin_import_preview():
    conn = get_db()
    try:
        department_id = int(request.form["department_id"])
    except (KeyError, ValueError):
        flash("取り込み先の部署を選択してください。", "error")
        return redirect(url_for("admin_import"))

    upload = request.files.get("file")
    if upload and upload.filename:
        if not upload.filename.lower().endswith((".xlsx", ".xlsm")):
            flash("Excelファイル(.xlsx / .xlsm)を選択してください。", "error")
            return redirect(url_for("admin_import"))
        IMPORT_DIR.mkdir(parents=True, exist_ok=True)
        token = uuid.uuid4().hex
        upload.save(IMPORT_DIR / f"{token}.xlsx")
    else:
        token = request.form.get("token", "")

    path = IMPORT_DIR / f"{token}.xlsx" if token else None
    if not token or not path.exists():
        flash("Excelファイルを選択してください。", "error")
        return redirect(url_for("admin_import"))

    try:
        wb = excel_import.open_workbook(path)
    except Exception:
        flash("Excelファイルを読み込めませんでした。ファイル形式を確認してください。", "error")
        return redirect(url_for("admin_import"))

    sheet_names = wb.sheetnames
    sheet_name = request.form.get("sheet_name") or sheet_names[0]
    if sheet_name not in sheet_names:
        sheet_name = sheet_names[0]
    ws = wb[sheet_name]

    header = excel_import.detect_day_header(ws)
    if header:
        header_row, day_start_col, _ = header
        name_col = excel_import.guess_name_column(header_row, day_start_col)
        staff_start, staff_end = excel_import.guess_staff_rows(ws, header_row, name_col)
    else:
        header_row, day_start_col, name_col = 1, 2, 1
        staff_start, staff_end = 2, 2

    rows, col_letters = excel_import.build_preview(ws)

    return render_template(
        "admin_import_preview.html",
        department_id=department_id,
        token=token,
        sheet_names=sheet_names,
        sheet_name=sheet_name,
        rows=rows,
        col_letters=col_letters,
        header_row=header_row,
        name_col_letter=excel_import.column_letter(name_col),
        day_start_col_letter=excel_import.column_letter(day_start_col),
        staff_start=staff_start,
        staff_end=staff_end,
        header_detected=header is not None,
        target_month_date=current_target_month(),
    )


@app.route("/admin/import/confirm", methods=["POST"])
def admin_import_confirm():
    conn = get_db()
    token = request.form.get("token", "")
    path = IMPORT_DIR / f"{token}.xlsx"
    department_id = None
    if not token or not path.exists():
        flash("取り込み元のファイルが見つかりません。もう一度アップロードしてください。", "error")
        return redirect(url_for("admin_import"))

    try:
        department_id = int(request.form["department_id"])
        sheet_name = request.form["sheet_name"]
        header_row = int(request.form["header_row"])
        name_col = excel_import.column_index(request.form["name_col"])
        day_start_col = excel_import.column_index(request.form["day_start_col"])
        staff_start = int(request.form["staff_start"])
        staff_end = int(request.form["staff_end"])
        if staff_end < staff_start:
            raise ValueError("職員の行範囲が正しくありません(終了行が開始行より前です)。")
        tm = current_target_month()
        staff_count, filled_count = excel_import.run_import(
            conn, logic, path, sheet_name, department_id, header_row, name_col,
            staff_start, staff_end, day_start_col, tm.year, tm.month,
        )
        flash(f"{staff_count}名分の職員・{filled_count}件のシフトを取り込みました。", "success")
    except (KeyError, ValueError) as e:
        flash(f"取り込みに失敗しました: {e}", "error")
        return redirect(url_for("admin_import"))
    finally:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    return redirect(url_for("shift_table", department_id=department_id))


@app.route("/admin/month", methods=["POST"])
def admin_start_new_month():
    conn = get_db()
    try:
        new_month = request.form["new_month"]
        datetime.strptime(new_month, "%Y-%m-%d")
        logic.start_new_month(conn, new_month)
        flash(f"対象年月を {new_month[:7]} に切り替え、シフト表をリセットしました。", "success")
    except (ValueError, KeyError):
        flash("日付を正しく入力してください。", "error")
    return redirect(url_for("admin"))


@app.route("/admin/leave_code", methods=["POST"])
def admin_set_leave_code():
    conn = get_db()
    code = request.form.get("leave_code", "").strip() or "年"
    db.set_setting(conn, "leave_code", code)
    conn.commit()
    flash("有給の勤務コードを更新しました。", "success")
    return redirect(url_for("admin"))


@app.route("/admin/shift_cell", methods=["POST"])
def admin_set_shift_cell():
    conn = get_db()
    department_id = int(request.form["department_id"])
    staff_name = request.form["staff_name"]
    target_date = request.form["target_date"]
    shift_code = request.form.get("shift_code", "").strip()
    logic.ensure_roster(conn, department_id, staff_name)
    logic.set_shift_code(conn, department_id, staff_name, target_date, shift_code)
    conn.commit()
    return redirect(url_for("shift_table", department_id=department_id))


@app.route("/admin/roster", methods=["POST"])
def admin_add_roster():
    conn = get_db()
    department_id = int(request.form["department_id"])
    staff_name = request.form["staff_name"]
    if staff_name.strip():
        logic.ensure_roster(conn, department_id, staff_name)
        conn.commit()
        flash(f"{normalize_name(staff_name)} さんを追加しました。", "success")
    return redirect(url_for("shift_table", department_id=department_id))


def list_staff_names(conn, approvers_only=False):
    if approvers_only:
        rows = conn.execute(
            "SELECT name FROM staff WHERE role LIKE '%承認者%' ORDER BY name"
        ).fetchall()
    else:
        rows = conn.execute("SELECT name FROM staff ORDER BY name").fetchall()
    return [r["name"] for r in rows]


if __name__ == "__main__":
    db.init_db()
    with app.app_context():
        logic.ensure_default_admin_password(get_db())
    app.run(host="0.0.0.0", port=5000, debug=False)
