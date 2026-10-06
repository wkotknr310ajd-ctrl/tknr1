# 補助金カレンダー（自動更新）

福祉施設・NPO 向けの補助金・助成金の申請時期を一覧にした Excel を、Claude が定期的に Web で調べ直して自動更新する仕組みです。
モーニングコールアプリ本体とは独立しています。

## ファイル

| ファイル | 内容 |
|---|---|
| `補助金カレンダー.xlsx` | **見る用のファイル**。自動生成されるので直接編集しない |
| `data/subsidies.json` | 補助金データの元データ（名称・申請月・募集期間・出典など） |
| `data/history.json` | 自動更新で変わった点の記録（Excel の「更新履歴」シートになる） |
| `scripts/build_xlsx.py` | JSON から Excel を作るスクリプト |
| `UPDATE_PROCEDURE.md` | 自動更新で Claude が従う手順書 |

## Excel の見方

- **Sheet1**: 元の補助金カレンダーと同じ並び（7月〜翌6月）に、次の列を追加
  - 状況: 「募集中（あと◯日）」「募集予定」「今期終了・次回未発表」「要確認」
  - 次の締切 / 募集期間（最新） / 確度 / 備考 / 今回の変更 / 公式URL / 最終確認日
  - 色: 青=申請月、オレンジ=今月、赤=募集中、黄=締切2週間以内・今回変わった項目
- **更新履歴**: いつ・何が・なぜ変わったか（出典URLつき）

## 自動更新

Claude Code の Routine（定期実行）が毎週、`UPDATE_PROCEDURE.md` の手順で各補助金を Web 検索し、
`data/*.json` を更新 → Excel を再生成 → コミット・push します。

## 補助金を追加・変更したいとき

`data/subsidies.json` に項目を追加（または Claude に「◯◯財団を追加して」と頼む）して、

```bash
pip install -r subsidies/requirements.txt
python3 subsidies/scripts/build_xlsx.py
```

で Excel を作り直します。`name` は利用者のメモとして扱い、自動更新では書き換えません。
