#!/usr/bin/env python3
"""個人情報チェック（Claude Code の PreToolUse フック）

Claude が git commit / git push / GitHub へのファイル送信をしようとしたとき、
送られる内容に個人情報らしきものがあれば止める。

- 調べるのは「新しく追加される行」だけ（既存の行は対象外）
- Excel / Word / PowerPoint は中の文字を取り出して調べる
- 誤検知を通したいときは、ユーザーの了承を得てから
  .claude/pii-allow.txt にその文字列を1行で書く
"""
import html
import json
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ALLOW_FILE = os.path.join(ROOT, ".claude", "pii-allow.txt")

# 調べないファイル（ルールの説明やこのチェック自体）
SKIP_FILES = {"CLAUDE.md", "package-lock.json", ".claude/hooks/pii_check.py", ".claude/pii-allow.txt"}

PATTERNS = [
    ("受給者証番号・被保険者番号などの記載", re.compile(r"(受給者証|被保険者|保険者)番号")),
    ("マイナンバー（個人番号）の記載", re.compile(r"マイナンバー|個人番号")),
    ("生年月日の記載", re.compile(r"生年月日|(昭和|平成|令和|[SHR])\s*\d{1,2}\s*[年.\/]\s*\d{1,2}\s*[月.\/]\s*\d{1,2}\s*日?\s*生")),
    ("病名・服薬などの記載", re.compile(r"診断名|病名|既往歴|服薬|処方薬|主治医")),
    ("障害支援区分の記載", re.compile(r"(障害)?支援区分\s*[:：]?\s*[1-6１-６]")),
    ("氏名欄の記載", re.compile(r"(氏名|利用者名|職員名)\s*[:：]\s*[^\s\"',，、]{2,}")),
    ("住所の記載", re.compile(r"(住所|現住所)\s*[:：]|[都道府県].{1,6}[市区町村].{1,10}\d+[-ー－]\d+")),
    ("電話番号らしき数字", re.compile(r"(?<!\d)0\d{1,4}[-ー－(（]\d{1,4}[-ー－)）]\d{3,4}(?!\d)|(?<!\d)0[789]0\d{8}(?!\d)")),
    ("10桁の番号（受給者証番号の可能性）", re.compile(r"(?<![\d.])\d{10}(?![\d.])")),
    ("12桁の番号（マイナンバーの可能性）", re.compile(r"(?<![\d.])\d{4}\s?\d{4}\s?\d{4}(?![\d.])")),
    ("メールアドレス", re.compile(r"[\w.+-]+@(?!example\.|anthropic\.com|users\.noreply\.github\.com)[\w-]+\.[\w.-]+")),
]

OFFICE_EXT = (".xlsx", ".xlsm", ".docx", ".pptx")


def run(args):
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def load_allow():
    try:
        with open(ALLOW_FILE, encoding="utf-8") as f:
            return [l.strip() for l in f if l.strip() and not l.startswith("#")]
    except OSError:
        return []


def office_text(path):
    try:
        with zipfile.ZipFile(path) as z:
            parts = []
            for n in z.namelist():
                if re.match(r"(xl/sharedStrings|xl/worksheets/.*|word/document|ppt/slides/.*)\.xml$", n):
                    xml = z.read(n).decode("utf-8", "ignore")
                    parts.append(html.unescape(re.sub(r"<[^>]+>", "\n", xml)))
            return "\n".join(parts)
    except (OSError, zipfile.BadZipFile):
        return ""


def added_lines_from_diff(diff):
    """unified diff から {ファイル: [追加行]} を作る"""
    out, cur = {}, None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            p = line[4:]
            cur = p[2:] if p.startswith("b/") else None
        elif cur and line.startswith("+") and not line.startswith("+++"):
            out.setdefault(cur, []).append(line[1:])
    return out


def collect_local(command):
    """これからコミット／プッシュされうる内容を集める"""
    texts = {}
    if re.search(r"\bgit\b[^;&|]*\bpush\b", command):
        upstream = run(["git", "rev-parse", "--abbrev-ref", "@{u}"]).strip()
        base = upstream or ("origin/main" if run(["git", "rev-parse", "--verify", "origin/main"]) else "")
        rng = f"{base}..HEAD" if base else "HEAD"
        diff = run(["git", "diff", "--no-color", "-U0", rng]) if base else run(["git", "show", "--no-color", "-U0", "--format=", "HEAD"])
        texts.update(added_lines_from_diff(diff))
        changed = run(["git", "diff", "--name-only", rng] if base else ["git", "show", "--name-only", "--format=", "HEAD"]).split()
    else:
        changed = []
    # コミット前: ステージ済み＋未ステージ＋未追跡（git add -A などで入りうるもの）
    for f, lines in added_lines_from_diff(run(["git", "diff", "--no-color", "-U0", "HEAD"])).items():
        texts.setdefault(f, []).extend(lines)
    changed += run(["git", "diff", "--name-only", "HEAD"]).split()
    for f in run(["git", "ls-files", "--others", "--exclude-standard"]).splitlines():
        changed.append(f)
        if not f.lower().endswith(OFFICE_EXT):
            try:
                with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
                    texts.setdefault(f, []).extend(fh.read().splitlines())
            except (OSError, UnicodeDecodeError):
                pass
    for f in set(changed):
        if f.lower().endswith(OFFICE_EXT) and os.path.exists(os.path.join(ROOT, f)):
            texts[f] = office_text(os.path.join(ROOT, f)).splitlines()
    return texts


def collect_github(tool_input):
    texts = {}
    if "files" in tool_input:  # push_files
        for f in tool_input.get("files") or []:
            texts[f.get("path", "?")] = str(f.get("content", "")).splitlines()
    elif "content" in tool_input:  # create_or_update_file
        texts[tool_input.get("path", "?")] = str(tool_input.get("content", "")).splitlines()
    return texts


def scan(texts):
    allow = load_allow()
    hits = []
    for f, lines in texts.items():
        if f in SKIP_FILES:
            continue
        for line in lines:
            line = re.sub(r"https?://\S+", " ", line)  # URL の中の数字は対象外
            for label, pat in PATTERNS:
                for m in pat.finditer(line):
                    s = m.group(0)
                    if any(a in line for a in allow):
                        continue
                    hits.append((f, label, s))
    return hits


def main():
    data = json.load(sys.stdin)
    tool = data.get("tool_name", "")
    ti = data.get("tool_input") or {}
    if tool == "Bash":
        cmd = ti.get("command", "")
        if not re.search(r"\bgit\b[^;&|]*\b(commit|push)\b", cmd):
            return
        texts = collect_local(cmd)
    else:
        texts = collect_github(ti)
    hits = scan(texts)
    if not hits:
        return
    shown, seen = [], set()
    for f, label, s in hits:
        if (f, label) in seen:
            continue
        seen.add((f, label))
        shown.append(f"- {f}: {label}（例: 「{s[:2]}…」）")
        if len(shown) >= 15:
            break
    reason = (
        "【個人情報チェックで停止しました】送ろうとした内容に、個人情報らしきものが含まれています。\n"
        + "\n".join(shown)
        + "\n\nユーザーに上の一覧を見せ、どうするか確認してください。"
        "本物の個人情報ならダミーに置き換えるかファイルを外してください。"
        "誤検知だとユーザーがはっきり了承した場合に限り、該当行に含まれる文字列を "
        ".claude/pii-allow.txt に1行で追記してから、もう一度実行してください。"
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
        "systemMessage": "個人情報チェック: 個人情報らしき内容があったため、保存（コミット／送信）を止めました",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
