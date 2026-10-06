# 補助金カレンダー 自動更新手順（Claude 用）

定期実行の Claude がこの手順で `subsidies/data/subsidies.json` を最新化し、
`subsidies/補助金カレンダー.xlsx` を作り直してコミットする。人が手で回すときも同じ手順でよい。

## 1. 準備

```bash
pip install -q -r subsidies/requirements.txt
```

今日の日付（日本時間）を確認し、`subsidies.json` と `history.json` を読む。

## 2. 調べる

`subsidies` の各補助金について、WebSearch で次を調べる（並列でまとめて検索してよい）。

- 検索語の例: `<財団名> 助成 募集 <今年> 募集期間`、`<財団名> <来年度>年度 助成`
- 確認すること
  - 最新回の **募集期間（開始日・締切日）**。複数回（前期/後期、第1〜3期など）あればすべて
  - 補助上限額・補助率の変更
  - 制度の廃止・名称変更・対象の大きな変更
- 信頼できる順: 財団・省庁・自治体の公式ページ ＞ 社協・市民活動センター・自治体の転載 ＞ 補助金ポータル等のまとめサイト
- 公式サイトがネットワーク制限で開けない場合は、WebSearch の結果と転載ページで判断する

`confidence` の付け方:

| 値 | 条件 |
|---|---|
| 確認済 | 今回の募集回の日程が要項・公式発表・信頼できる転載で確認できた |
| 推定 | 今回の日程は未発表だが、前年度の日程から推定した（該当 period に `"estimated": true`） |
| 要確認 | 今年度分が見つからない、または自治体ごとに異なり一つに決められない |

## 3. 更新する（`subsidies/data/subsidies.json`）

- `periods`: 最新の募集回に置き換える。終わった回は、次回が発表されるまで残しておく
  （「今期終了・次回未発表」と表示される）。日付は `YYYY-MM-DD`。開始日不明なら `start` を省略
- `calendar`: 申請できる月に `"申請"`、結果発表月に `"結果"` など。キーは月番号の文字列（`"7"`〜`"6"`）。
  募集期間が変わって申請月がずれたら合わせて直す
- `note`: 締切の時刻・必着/消印・対象地域・上限の内訳など、申請判断に要ることを短く
- `official_url` / `sources`: 公式ページと、根拠にしたページの URL
- `last_checked`: 今日の日付（変更がなくても調べた補助金は更新する）
- トップレベルの `last_updated`: 今日の日付
- `fiscal_start_year`: 7月になったら翌年度へ進める（例: 2027年7月以降は 2027）。カレンダーは 7月〜翌6月
- **`name` は原則変えない**（利用者が付けた名前とメモ）。上限額などが変わったときは `note` と履歴に書く
- 新しく見つけた有望な補助金は勝手に追加しない。最後の報告で「候補」として挙げるだけにする

## 4. 履歴を残す（`subsidies/data/history.json`）

`calendar`・`periods`（日程の変更・新年度分の発表）・上限額・`confidence`・`official_url` に
意味のある変化があったら、配列の末尾に 1 件ずつ追加する。

```json
{"date": "YYYY-MM-DD", "id": "<subsidy id>", "field": "calendar|periods|note|confidence|official_url",
 "before": "変更前（短く）", "after": "変更後（短く）", "reason": "なぜ変えたか", "source": "根拠URL"}
```

`last_checked` だけの更新は履歴に書かない。

## 5. Excel を作り直して確認する

```bash
python3 subsidies/scripts/build_xlsx.py
```

エラーが出たら JSON を直して再実行する。生成した Excel を openpyxl で開き、
件数（22件前後）と「状況」列がおかしくないかざっと確認する。

## 6. コミットして push

```bash
git add subsidies/
git commit -m "補助金カレンダーを更新（YYYY-MM-DD）"
git push -u origin <対象ブランチ>
```

変更がなく `last_checked` だけ変わった場合もコミットしてよい（確認した記録になる）。

## 7. 報告

最後に日本語で短く報告する:

- 今「募集中」のもの（締切が近い順、締切日つき）
- 今回変わった点（`history.json` に追加した内容）
- 「要確認」のまま残っているもの
- 新しく見つけた候補の補助金（あれば）
