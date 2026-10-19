# 補助金カレンダー

福祉施設・NPO 向けの補助金・助成金の申請時期を一覧にした Excel を、Claude に頼むと Web で調べ直して更新する仕組みです。
モーニングコールアプリ本体とは独立しています。

## ファイル

| ファイル | 内容 |
|---|---|
| `補助金カレンダー.xlsx` | **見る用のファイル**。スクリプトで作り直すので直接編集しない |
| `data/subsidies.json` | 補助金データの元データ（名称・申請月・募集期間・出典など） |
| `data/history.json` | 更新で変わった点の記録（Excel の「更新履歴」シートになる） |
| `scripts/build_xlsx.py` | JSON から Excel を作るスクリプト |
| `UPDATE_PROCEDURE.md` | 更新のときに Claude が従う手順書 |

## Excel の見方

- **Sheet1**: 元の補助金カレンダーと同じ並び（7月〜翌6月）に、次の列を追加
  - 状況: 「募集中（あと◯日）」「募集予定」「今期終了・次回未発表」「要確認」
  - 次の締切 / 募集期間（最新） / 確度 / 備考 / 今回の変更 / 公式URL / 最終確認日
  - 色: 青=申請月、オレンジ=今月、赤=募集中、黄=締切2週間以内・今回変わった項目
- **更新履歴**: いつ・何が・なぜ変わったか（出典URLつき）

## 更新のしかた（手動）

1. claude.ai/code でこのリポジトリ（wkotknr310ajd-ctrl/tknr1）を選んで新しいセッションを開く
2. 次のように頼む

   > subsidies/UPDATE_PROCEDURE.md の手順で補助金カレンダーを更新して、main にマージして

3. 終わると、募集中のもの・変更点・要確認のものが報告され、main の `補助金カレンダー.xlsx` が新しくなる

## 補助金を追加・変更したいとき

`data/subsidies.json` に項目を追加（または Claude に「◯◯財団を追加して」と頼む）して、

```bash
python3 -m pip install -r subsidies/requirements.txt
python3 subsidies/scripts/build_xlsx.py
```

で Excel を作り直します。`name` は利用者のメモとして扱い、更新時も書き換えません。
