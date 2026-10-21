# Shortcut Hubをインターネットに公開する

この手順は、ExpressとSQLiteを維持してRenderで公開するためのものです。
無料URLとHTTPSを使えるため、独自ドメインの購入は不要です。
サーバーと永続ディスクは有料です。サービスを作成する前に、表示される料金を確認してください。

## 用意した設定

リポジトリのルートにある`render.yaml`に、次の内容をまとめています。
実際のプログラムは`shortcut-hub/`にあるため、Root Directoryを指定しています。

| 設定 | 値 |
| --- | --- |
| Service type | Web Service |
| Runtime | Node |
| Root Directory | `shortcut-hub` |
| Region | Singapore |
| Compute plan | `0.5c-512mb`（旧Starter） |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/shortcuts` |
| Instances | 1 |
| Persistent Disk | 1GB、マウント先`/var/data` |
| `DATABASE_PATH` | `/var/data/shortcuts.db` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY_HOPS` | `1` |

Node.jsは`.node-version`で24.22.0を指定しています。
`TRUST_PROXY_HOPS=1`は、Renderのプロキシを1段信頼して接続元IPを使う設定です。
ローカルでは未設定のままにします。別の公開先へ移す場合は、その環境のプロキシ構成を確認して設定してください。

## 料金の目安

2026年10月21日に確認した構成の基本料金は、Computeが月7米ドル、1GBのDiskが月0.25米ドルで、合計月7.25米ドルです。
税、為替、追加の通信量などは別です。これは月額料金の上限を保証するものではありません。
作成画面と[Render公式料金](https://render.com/pricing)を最終確認してください。

Renderの無料Web Serviceには永続ディスクを付けられません。
このアプリで無料プランの一時ファイル領域へSQLiteを置くと、休止・再起動・再デプロイで投稿が消えるため、この設定では有料ディスクを使います。

## 公開の手順

1. 設定を含むソースをGitHubへpushします。`data/`、`.env`、`node_modules/`、`.verification/`は含めません。
2. RenderのアカウントでGitHubリポジトリを選び、Blueprintから`render.yaml`を読み込みます。
3. 上の表と作成画面の設定・料金が一致することを確認して、サービスを作成します。
4. ビルドログで`npm ci`が成功し、起動ログに`Shortcut Hub`が出ることを確認します。
5. Renderが発行する`https://...onrender.com`のURLを開きます。
6. 投稿、検索、カテゴリ絞り込み、投稿者用パスワードでの削除を確認します。
7. サービスを再起動し、保存した投稿が残ることを確認します。

最初のデータベースは空です。PCに保存している投稿は自動的には移動しません。
既存データを移す場合は、バックアップを取り、Renderの永続ディスクへ安全に転送する作業を別途行います。DBをGitHubへ登録して移さないでください。

## 更新とバックアップ

この設定は自動デプロイを無効にしています。更新はGitHubへpushしてからRenderのManual Deployで行います。
永続ディスクを付けたサービスは、更新時に短い停止時間が発生することがあります。
SQLiteのバックアップはアプリを停止した状態でファイルをコピーするか、SQLiteのバックアップ機能を使います。
保存先のファイルを削除すると投稿は失われるため、バックアップは別の場所へ保管してください。

## 公開リポジトリのバックアップファイルについて

以前のコミットに`.verification/`のDBバックアップが含まれている場合、除外設定を追加しても過去のコミットには残ります。
この準備で追加したルートの`.gitignore`は、今後の登録を防ぐためのものです。
過去の公開分の扱いは、履歴の整理やリポジトリの公開範囲の変更を別途判断してください。

## 公式資料

- [Expressアプリの公開](https://render.com/docs/deploy-node-express-app)
- [永続ディスク](https://render.com/docs/disks)
- [Blueprint設定](https://render.com/docs/blueprint-spec)
- [無料プランの制限](https://render.com/docs/free)
- [Expressのプロキシ設定](https://expressjs.com/ja/guide/behind-proxies/)
