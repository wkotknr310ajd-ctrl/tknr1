# -*- coding: utf-8 -*-
"""HTTP経由(実際のフォーム送信)での動作確認。"""
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

client = appmod.app.test_client()


def check(label, cond, extra=""):
    status = "OK" if cond else "NG"
    print(f"[{status}] {label} {extra}")
    if not cond:
        raise SystemExit(f"FAILED: {label} {extra}")


# 職員登録(管理画面のフォーム経由)
r = client.post("/admin/staff", data={"name": "山田一郎", "password": "yamada1"}, follow_redirects=True)
check("職員登録(一般)", "山田一郎 さんを登録しました" in r.get_data(as_text=True))

r = client.post("/admin/staff", data={"name": "課長　花子", "password": "kacho1", "is_approver": "on"},
                 follow_redirects=True)
check("職員登録(承認者)", "課長花子 さんを登録しました" in r.get_data(as_text=True))

# 部署IDを取得
conn = db.get_conn()
dept = [d for d in logic.list_departments(conn) if d["name"] == "通所"][0]
conn.close()

# 職員をロースターに追加(シフト表ページのフォーム経由)
r = client.post("/admin/roster", data={"department_id": dept["id"], "staff_name": "山田一郎"},
                 follow_redirects=True)
check("ロースター追加", "山田一郎 さんを追加しました" in r.get_data(as_text=True))

# シフトセルを設定
r = client.post("/admin/shift_cell", data={
    "department_id": dept["id"], "staff_name": "山田一郎",
    "target_date": "2026-09-10", "shift_code": "早",
}, follow_redirects=True)
check("シフトセル設定", "早" in r.get_data(as_text=True))

# 単独申請フォーム送信
r = client.post("/request", data={
    "applicant": "山田一郎", "password": "yamada1",
    "target_date": "2026-09-10", "new_shift": "遅", "reason": "テスト",
}, follow_redirects=True)
body = r.get_data(as_text=True)
check("申請フォーム送信", "申請を受け付けました" in body)

conn = db.get_conn()
pending = logic.list_pending(conn)
req_id = pending[0]["request_id"]
conn.close()

# 承認フォーム送信(承認者名にスペースが入っていても認証できるか)
r = client.post("/approve", data={
    "request_id": req_id, "approver": "課長 花子", "password": "kacho1", "decision": "承認",
}, follow_redirects=True)
body = r.get_data(as_text=True)
check("承認フォーム送信(スペース入り氏名でも認証成功)", "承認しました" in body, body[:200])

conn = db.get_conn()
_, shift = logic.get_current_shift(conn, "山田一郎", "2026-09-10")
conn.close()
check("承認後にシフト反映(HTTP経由)", shift == "遅")

# current_shift API
r = client.get("/api/current_shift?name=山田一郎&date=2026-09-10")
check("current_shift API", r.get_json()["shift"] == "遅")

# シフト表ページの表示確認
r = client.get(f"/shift/{dept['id']}")
check("シフト表ページ表示", r.status_code == 200 and "山田一郎" in r.get_data(as_text=True))

print("\nHTTP経由のテストにすべて合格しました。")
