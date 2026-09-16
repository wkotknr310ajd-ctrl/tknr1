# -*- coding: utf-8 -*-
"""勤務変更申請・承認システム(Webアプリ版)のエントリポイント。"""
from datetime import date, datetime

from flask import Flask, flash, g, jsonify, redirect, render_template, request, url_for

import db
import logic
from security import days_in_month, month_start, normalize_name

app = Flask(__name__)
app.secret_key = "shift-change-system-local-secret"  # 社内LAN限定運用のための簡易な値


def get_db():
    if "db" not in g:
        g.db = db.get_conn()
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


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
    app.run(host="0.0.0.0", port=5000, debug=False)
