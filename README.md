# 名刺スキャナー (meishi-scanner)

スマホのカメラで名刺を撮影すると、文字を自動で読み取り（OCR）、内容を確認・修正してから
**あなたの Google ドライブ**にそのまま保存できる Web アプリ（PWA）です。保存した名刺は一覧から
いつでも開いて、**LINE でワンタップ共有**できます。

## 特徴

- 📷 カメラ撮影 or 画像選択で名刺を取り込み
- 🔤 ブラウザ内 OCR（[Tesseract.js](https://github.com/naptha/tesseract.js)、日本語+英語）でテキストを自動抽出
- ✍️ 氏名・会社名・役職・電話番号・FAX・メール・住所・Web・メモを自動抽出＋手動修正
- ☁️ データは自分の Google ドライブ内の「名刺スキャナー」フォルダに JSON として保存（サーバー不要、アプリ独自のバックエンドは持ちません）
- 💬 保存した名刺情報を LINE にワンタップで共有（LINE の共有 URL を利用、テキストのみ）
- 📱 PWA 対応でホーム画面に追加してアプリのように利用可能

## 仕組み・データの扱いについて

このアプリはバックエンドサーバーを持たない**完全クライアントサイド構成**です。

- OCR はすべて端末のブラウザ内で実行されます（画像が外部サーバーに送信されることはありません）。
- 名刺データの保存・取得は [Google Drive API](https://developers.google.com/drive) を直接呼び出しており、
  認証には [Google Identity Services](https://developers.google.com/identity/oauth2/web) の
  `drive.file` スコープ（このアプリが作成したファイルのみアクセス可能な限定スコープ）を使用します。
- LINE への共有は LINE の共有用 URL（`https://line.me/R/msg/text/?...`）を新しいタブ/LINEアプリで開く方式です。
  これは特別な LINE Developers 登録なしで使える公式の共有導線で、テキスト（氏名・会社名・電話番号など）を
  LINE のトーク選択画面に受け渡します。

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. Google Cloud で OAuth クライアントIDを作成する

Google ドライブへの保存には、あなた自身の Google Cloud プロジェクトで OAuth クライアントIDを
発行する必要があります（無料の範囲で利用できます）。

1. [Google Cloud Console](https://console.cloud.google.com/) で新しいプロジェクトを作成（または既存のものを選択）
2. 「APIとサービス」→「有効な API とサービス」から **Google Drive API** を有効化
3. 「APIとサービス」→「OAuth 同意画面」を設定
   - User Type は「外部」でOK（個人利用なら「テストユーザー」に自分の Google アカウントを追加）
   - スコープの追加は不要（アプリ側は `drive.file` のみ要求します）
4. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアントID」
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 「承認済みの JavaScript 生成元」に以下を追加
     - `http://localhost:5173`（ローカル開発用）
     - 実際に公開する URL（例: `https://your-domain.example.com`）
5. 発行された「クライアントID」をコピー

### 3. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を開き、取得したクライアントIDを設定します。

```
VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

表示された URL（デフォルト `http://localhost:5173`）にスマホ・PCのブラウザでアクセスします。
カメラを使う場合、`localhost` 以外でアクセスするときは HTTPS が必須です（ブラウザのカメラ制約）。

### 5. ビルド

```bash
npm run build
npm run preview
```

`dist` フォルダを任意の静的ホスティング（Vercel, Netlify, Cloudflare Pages, GitHub Pages など）に
デプロイしてください。デプロイ後は、OAuth クライアントIDの「承認済みの JavaScript 生成元」に
本番 URL を追加するのを忘れないようにしてください。

### GitHub Pages への自動デプロイ

`.github/workflows/deploy-pages.yml` により、`main` ブランチへの push（または手動実行）で
自動的に GitHub Pages（`https://<ユーザー名>.github.io/tknr1/`）へデプロイされます。

- Google ドライブ連携を有効にした状態でデプロイしたい場合は、リポジトリの
  Settings → Secrets and variables → Actions で `VITE_GOOGLE_CLIENT_ID` という名前の
  Secret を登録してください（未設定でもビルド・公開は可能ですが、その場合サインイン機能は無効になります）。
- Client ID の「承認済みの JavaScript 生成元」には `https://<ユーザー名>.github.io` を追加してください。
- 初回のみ、リポジトリの Settings → Pages で Source が「GitHub Actions」になっていることを確認してください
  （ワークフローが自動で有効化しますが、反映されない場合は手動で選択してください）。

## 使い方

1. 右上の「Googleでサインイン」でログイン
2. 「+ 名刺を読み取る」タブでカメラ撮影 or 画像を選択
3. 自動抽出された内容を確認・修正
4. 「Googleドライブに保存」で保存（ドライブ内に「名刺スキャナー」フォルダが自動作成されます）
5. 「一覧」タブから保存済みの名刺を開き、「LINEで共有」ボタンでLINEに共有

## 制限事項

- OCR の自動抽出（氏名・会社名などの振り分け）は完全ではありません。保存前に必ず内容を確認してください。
- ブラウザ内 OCR のため、初回読み取り時に言語データ（数MB）のダウンロードが発生します。
- `drive.file` スコープの都合上、このアプリで保存したファイル以外（他アプリで作成したファイル等）にはアクセスしません。

## 技術スタック

- Vite + React + TypeScript
- Tesseract.js（OCR）
- Google Identity Services + Drive API v3（fetch 直接呼び出し、gapi 非使用）
- vite-plugin-pwa（PWA / Service Worker）
