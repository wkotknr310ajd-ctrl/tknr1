# -*- coding: utf-8 -*-
"""手動テストスクリプト: Flaskのtest_clientでアプリ全体の流れを検証する。"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

DB_FILE = os.path.join(os.path.dirname(__file__), "data", "app.db")
if os.path.exists(DB_FILE):
    os.remove(DB_FILE)

import db  # noqa: E402
db.init_db()

import app as appmod  # noqa: E402
import logic  # noqa: E402

conn = db.get_conn()
logic.ensure_default_admin_password(conn)
conn.close()

client = appmod.app.test_client()
with client.session_transaction() as sess:
    sess["admin_authed"] = True


def check(label, cond):
    status = "OK" if cond else "NG"
    print(f"[{status}] {label}")
    if not cond:
        raise SystemExit(f"FAILED: {label}")


# --- 職員登録 ---
conn = db.get_conn()
logic.register_staff(conn, "田中太郎", "pass123", is_approver=False)
logic.register_staff(conn, "鈴木　部長", "boss123", is_approver=True)  # 全角スペース入り
conn.close()

conn = db.get_conn()
staff = logic.find_staff(conn, "田中太郎")
check("職員登録(田中太郎)", staff is not None)
boss = logic.find_staff(conn, "鈴木部長")  # スペースなしで検索しても見つかるはず
check("氏名の正規化(スペース無視で検索できる)", boss is not None)
conn.close()

# --- 部署ロースター登録 + シフトセル設定 ---
conn = db.get_conn()
depts = logic.list_departments(conn)
dept_入所 = [d for d in depts if d["name"] == "入所"][0]
logic.ensure_roster(conn, dept_入所["id"], "田中太郎")
logic.set_shift_code(conn, dept_入所["id"], "田中太郎", "2026-09-20", "日勤")
conn.commit()
conn.close()

conn = db.get_conn()
dept_id, shift = logic.get_current_shift(conn, "田中太郎", "2026-09-20")
check("現在の勤務取得", shift == "日勤")
conn.close()

# --- 単独申請 → 承認 → シフト反映確認 ---
conn = db.get_conn()
req_id, before = logic.submit_single_request(conn, "田中太郎", "pass123", "2026-09-20", "×", "私用のため")
check("単独申請の登録", before == "日勤")
conn.close()

conn = db.get_conn()
pending = logic.list_pending(conn)
check("承認待ち1件", len(pending) == 1)
conn.close()

conn = db.get_conn()
msg, warnings = logic.process_approval(conn, req_id, "鈴木部長", "boss123", "承認")
check("承認成功", "承認しました" in msg)
check("警告なし", warnings == [])
conn.close()

conn = db.get_conn()
_, shift_after = logic.get_current_shift(conn, "田中太郎", "2026-09-20")
check("承認後にシフト表へ反映", shift_after == "×")
conn.close()

# --- ロールバック ---
conn = db.get_conn()
msg, warnings = logic.process_rollback(conn, req_id, "鈴木部長", "boss123")
check("ロールバック成功", "取り消しました" in msg)
conn.close()

conn = db.get_conn()
_, shift_rolled = logic.get_current_shift(conn, "田中太郎", "2026-09-20")
check("ロールバック後にシフト表が元に戻る", shift_rolled == "日勤")
conn.close()

# --- 交換申請 ---
conn = db.get_conn()
logic.register_staff(conn, "佐藤花子", "hanako1", is_approver=False)
logic.ensure_roster(conn, dept_入所["id"], "佐藤花子")
logic.set_shift_code(conn, dept_入所["id"], "佐藤花子", "2026-09-21", "夜A")
conn.commit()
req_id2, cur_a, cur_b = logic.submit_swap_request(
    conn, "田中太郎", "pass123", "田中太郎", "2026-09-20", "夜A", "佐藤花子", "2026-09-21", "日勤", "テスト交換"
)
conn.close()

conn = db.get_conn()
rows = logic.find_history_rows(conn, req_id2)
check("交換申請は履歴2行", len(rows) == 2)
check("交換申請の種別", all(r["kind"] == "勤務交換" for r in rows))
conn.close()

conn = db.get_conn()
msg, warnings = logic.process_approval(conn, req_id2, "鈴木部長", "boss123", "承認")
check("交換申請の承認成功", "承認しました" in msg)
conn.close()

conn = db.get_conn()
_, s1 = logic.get_current_shift(conn, "田中太郎", "2026-09-20")
_, s2 = logic.get_current_shift(conn, "佐藤花子", "2026-09-21")
check("交換後: 田中太郎が夜A", s1 == "夜A")
check("交換後: 佐藤花子が日勤", s2 == "日勤")
conn.close()

# --- 有給申請(日付範囲) ---
conn = db.get_conn()
req_id3, summary = logic.submit_leave_request(
    conn, "田中太郎", "pass123", "2026-09-22", "2026-09-24", "私用", "年"
)
check("有給申請は3日分", len(summary) == 3)
conn.close()

conn = db.get_conn()
msg, warnings = logic.process_approval(conn, req_id3, "鈴木部長", "boss123", "承認")
check("有給申請の承認成功", "承認しました" in msg)
conn.close()

conn = db.get_conn()
_, s22 = logic.get_current_shift(conn, "田中太郎", "2026-09-22")
check("有給承認後にシフトが年になる", s22 == "年")
conn.close()

# --- 超過勤務申請 ---
conn = db.get_conn()
req_id4, cur, new_shift, hours_label = logic.submit_overtime_request(
    conn, "田中太郎", "pass123", "2026-09-20", "17:30", "18:45", "急な対応"
)
check("残業時間の計算(1時間15分)", hours_label == "1時間15分")
check("残業後の勤務コード", new_shift == "夜A(残1時間15分)")
conn.close()

conn = db.get_conn()
msg, warnings = logic.process_approval(conn, req_id4, "鈴木部長", "boss123", "承認")
conn.close()

# --- 有給・残業の集計 ---
from datetime import date as _date  # noqa: E402

conn = db.get_conn()
leave_rows, fy_start, fy_end, leave_limit = logic.leave_summary(conn, today=_date(2026, 9, 25))
tanaka_leave = next(r for r in leave_rows if r["name"] == "田中太郎")
check("有給集計: 田中太郎の取得日数は3日", tanaka_leave["taken_days"] == 3)
check("有給集計: 残り日数は上限-3日", tanaka_leave["remaining_days"] == leave_limit - 3)

ot_rows, months, ot_fy_start, ot_fy_end, month_limit, year_limit = logic.overtime_summary(
    conn, today=_date(2026, 9, 25)
)
tanaka_ot = next(r for r in ot_rows if r["name"] == "田中太郎")
sep_index = months.index((2026, 9))
check("残業集計: 9月の残業時間は1.25時間", tanaka_ot["month_hours"][sep_index] == 1.25)
check("残業集計: 年度合計は1.25時間", tanaka_ot["year_hours"] == 1.25)
conn.close()

# --- 有給上限の職員ごとの個別設定 ---
conn = db.get_conn()
logic.set_staff_leave_limit(conn, "田中太郎", 10)
rows, *_ = logic.leave_summary(conn, today=_date(2026, 9, 25))
tanaka = next(r for r in rows if r["name"] == "田中太郎")
suzuki = next(r for r in rows if r["name"] == "鈴木部長")
check("有給上限の個別設定: 対象者だけ上限が変わる", tanaka["limit_days"] == 10 and tanaka["is_custom_limit"])
check("有給上限の個別設定: 他の職員は初期値のまま", suzuki["limit_days"] == leave_limit and not suzuki["is_custom_limit"])
logic.set_staff_leave_limit(conn, "田中太郎", None)
rows, *_ = logic.leave_summary(conn, today=_date(2026, 9, 25))
tanaka = next(r for r in rows if r["name"] == "田中太郎")
check("有給上限の個別設定: 空にすると初期値に戻る", tanaka["limit_days"] == leave_limit and not tanaka["is_custom_limit"])
conn.close()

# --- 種別ごとの履歴確認 ---
conn = db.get_conn()
all_hist = logic.list_history(conn)
shift_hist = logic.list_history(conn, ["勤務変更", "勤務交換"])
leave_hist = logic.list_history(conn, ["有給"])
overtime_hist = logic.list_history(conn, ["残業"])
check("全履歴件数 > 0", len(all_hist) > 0)
check("勤務変更履歴に単独+交換+ロールバック含む",
      any(r["kind"] == "勤務変更" for r in shift_hist) and any(r["kind"] == "勤務交換" for r in shift_hist))
check("有給履歴フィルタ", all(r["kind"] == "有給" for r in leave_hist) and len(leave_hist) == 3)
check("残業履歴フィルタ", all(r["kind"] == "残業" for r in overtime_hist) and len(overtime_hist) == 1)
conn.close()

# --- 月初めの切り替え ---
conn = db.get_conn()
logic.start_new_month(conn, "2026-10-01")
conn.close()

conn = db.get_conn()
_, shift_reset = logic.get_current_shift(conn, "田中太郎", "2026-09-20")
staff_after_reset = logic.find_staff(conn, "田中太郎")
check("月初め切り替え後、シフト表はリセットされる", shift_reset == "")
check("月初め切り替え後も職員マスタは残る", staff_after_reset is not None)
hist_after_reset = logic.list_history(conn)
check("月初め切り替え後も履歴は残る", len(hist_after_reset) > 0)
conn.close()

# --- 管理画面のパスワード保護 ---
unauth_client = appmod.app.test_client()
r = unauth_client.get("/admin", follow_redirects=False)
check("未ログインでは/adminにアクセスできない(ログイン画面へリダイレクト)", r.status_code in (301, 302))

r = unauth_client.post("/admin/login", data={"password": "wrong-password"}, follow_redirects=True)
check("誤った管理パスワードではログインできない", "パスワードが正しくありません" in r.get_data(as_text=True))

r = unauth_client.post("/admin/login", data={"password": logic.DEFAULT_ADMIN_PASSWORD}, follow_redirects=True)
check("初期パスワードでログインできる", r.status_code == 200 and "職員の登録" in r.get_data(as_text=True))

conn = db.get_conn()
try:
    logic.change_admin_password(conn, "wrong-password", "newpass123")
    check("誤った現在パスワードでは変更できない", False)
except logic.AppError:
    check("誤った現在パスワードでは変更できない", True)
logic.change_admin_password(conn, logic.DEFAULT_ADMIN_PASSWORD, "newpass123")
check("正しい現在パスワードで管理パスワードを変更できる", logic.verify_admin_password(conn, "newpass123"))
conn.close()

# --- HTTPルートの疎通確認 ---
for path in ["/", "/request", "/swap", "/leave", "/overtime", "/approve", "/rollback",
             "/history", "/history?kind=leave", "/admin", "/admin/summary", "/admin/import"]:
    resp = client.get(path)
    check(f"GET {path} -> 200", resp.status_code == 200)

print("\nすべてのテストに合格しました。")
