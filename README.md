# 秒刻みタイマー (byoshi-timer)

1秒ごとに小さい音、10秒ごとに大きい音が鳴るシンプルなタイマーの Web アプリ（PWA）です。

## 特徴

- ⏱ 1秒単位でカウントし、毎秒小さいチック音、10秒ごとに大きい音が鳴ります
- 🔊 音は Web Audio API で生成しており、外部の音声ファイルは使用しません
- ▶️ スタート・一時停止・リセット、ミュート切り替えに対応
- 📱 PWA 対応でホーム画面／デスクトップに追加してアプリのように利用可能
- ☁️ サーバー不要の完全クライアントサイド構成

## セットアップ

```bash
npm install
npm run dev
```

表示された URL（デフォルト `http://localhost:5173`）にブラウザでアクセスします。

## ビルド

```bash
npm run build
npm run preview
```

`dist` フォルダを任意の静的ホスティング（Vercel, Netlify, Cloudflare Pages, GitHub Pages など）に
デプロイしてください。

### GitHub Pages への自動デプロイ

`.github/workflows/deploy-pages.yml` により、`main` ブランチへの push（または手動実行）で
自動的に GitHub Pages（`https://<ユーザー名>.github.io/tknr1/`）へデプロイされます。

- 初回のみ、リポジトリの Settings → Pages で Source が「GitHub Actions」になっていることを確認してください
  （ワークフローが自動で有効化しますが、反映されない場合は手動で選択してください）。

## 使い方

1. 「スタート」でタイマー開始
2. 1秒ごとに小さい音、10秒ごとに大きい音が鳴ります
3. 「一時停止」で止めて「再開」で続きから、「リセット」で 0 に戻せます
4. 「🔊 音あり」ボタンでミュート切り替え

ホーム画面／デスクトップにアプリとして追加する場合は、ブラウザの「インストール」または
「ホーム画面に追加」機能を使ってください。

## 技術スタック

- Vite + React + TypeScript
- Web Audio API（音声生成）
- vite-plugin-pwa（PWA / Service Worker）
