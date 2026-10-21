# Shortcut Hubを無料枠で公開する

ExpressとSQLiteを維持して、RailwayのTrial / Freeプランで試す手順です。
クレジットカードを登録せず、有料プランへ変更しない方針です。
GitHubにコードを置くだけでは公開されません。Railwayのアカウントとサービスの作成が必要です。

## 無料で使える範囲

2026年10月21日に[公式料金](https://railway.com/pricing)と[無料トライアルの条件](https://docs.railway.com/pricing/free-trial)を確認しました。

- 初回は最大30日間、5米ドル分の利用クレジットがあります。先に使い切ると、その時点でTrialが終了します。
- その後のFreeプランは月1米ドル分です。サーバーの稼働・通信・Volumeなどの使用量に充てられます。
- Freeプランの上限を超えるとサービスは停止します。無料枠で常時公開できることは保証されません。
- 保存用Volumeは最大0.5GBです。通常の再起動・再デプロイでSQLiteを残すために使います。
- 公式資料では、TrialのVolumeはクレジット失効から30日後に削除されると案内されています。期限前にバックアップし、管理画面の保持条件も確認してください。

今回は無料で公開を体験する用途です。クレジットカードの入力やHobby / Proへの変更を求められたら、そこで止めます。
有料プランの利用上限設定で「0米ドル」にする方法ではなく、カード未登録のTrial / Freeのまま使います。

## Railwayで設定する値

GitHubリポジトリのルートには`shortcut-hub/`があります。
サービスのSettingsで次のように設定します。画面の表記は更新される場合があります。

| 項目 | 値 |
| --- | --- |
| GitHub Repository | `nalkdvi/shortcut-web` |
| Branch | `main` |
| Root Directory | `/shortcut-hub` |
| Builder | Railpack |
| Build Command | 未指定（`package-lock.json`から依存関係を自動インストール） |
| Start Command | `npm start` |
| Healthcheck Path | `/api/shortcuts` |
| Replicas | 1 |
| Serverless（旧App Sleeping） | 有効。変更後にデプロイする |
| Volume | アプリに接続し、マウント先を`/data`にする。無料枠の0.5GB以内 |

Variablesには次の値を登録します。

```text
NODE_ENV=production
DATABASE_PATH=/data/shortcuts.db
RAILPACK_NODE_VERSION=24.22.0
TRUST_RAILWAY_PROXY=true
```

`PORT`はRailwayが用意する値を使うため、自分では固定しません。
`TRUST_PROXY_HOPS`は未設定（既定値0）のままにします。
`TRUST_RAILWAY_PROXY=true`は、Railwayの公開HTTP経由でだけ使う設定です。
Railwayが付ける`X-Real-IP`をIP形式で検証してから、投稿・削除の回数制限に使います。
TCP Proxyや別サービスからの直接アクセスでは、この設定を使わないでください。ローカルでは未設定にします。

`DATABASE_PATH`を設定するだけではVolumeは作られません。実際に接続されていることを確認してください。
Railwayの旧`railway.json`設定方式は新規サービスで使えないため、追加の設定ファイルは作らず、管理画面で設定します。

## 公開の手順

1. [Railway](https://railway.com/)にログインします。作業するアカウントのプランがTrial / Freeで、カード未登録であることを確認します。
2. 新しいプロジェクトを作り、GitHubの`nalkdvi/shortcut-web`を選びます。リポジトリ連携の許可画面は内容を確認して操作してください。
3. 上の表のRoot Directory、Start Command、Variablesを設定します。最初の自動ビルドが失敗しても、設定後に再デプロイできます。
4. Volumeを作成してアプリのサービスへ接続し、マウント先を`/data`にします。Serverlessも有効にしてからデプロイします。
5. ビルドログで依存関係のインストール、起動ログで`Shortcut Hub`の起動を確認します。
6. SettingsのNetworking → Public NetworkingでGenerate Domainを選びます。発行された`https://...up.railway.app`が公開URLです。
7. `/api/shortcuts`がJSONを返すことと、トップページが表示されることを確認します。
8. 確認用の投稿で、複数URL・検索・カテゴリ絞り込み・削除用パスワードによる削除を確認します。
9. 削除前の確認用投稿が、サービスの再起動後も残ることを確認してから、パスワードで削除します。

最初の公開データベースは空です。PCに保存している投稿は自動的には移動しません。
既存データを移す場合はバックアップを取り、Volumeへ安全に転送します。DBをGitHubに登録して移さないでください。

## 休止・更新・バックアップ

Serverlessを有効にすると、通信がない状態が続いた後に休止し、アクセスで起動します。
最初の表示が遅い場合や、一度502になる場合があります。少し待って再読み込みしてください。
常時アクセスする監視サービスを付けると休止できず、無料クレジットを消費するので、今回は追加しません。

GitHubへのpushで自動デプロイされる設定の場合は、更新前に残りクレジットを確認します。
Volumeは再デプロイ時にも残りますが、サービスの停止時間が発生することがあります。
Volume自体の削除、保存期間の終了、アカウントの停止からはデータを守れないため、別の場所へバックアップします。
バックアップはアプリを停止してSQLiteファイルをコピーするか、SQLiteのバックアップ機能を使います。
稼働中のDBファイルだけをコピーすると不整合が起きる場合があるため、単純コピーは停止中に行います。

## 公開リポジトリのバックアップファイルについて

以前のコミットに`.verification/`のDBバックアップが含まれている場合、除外設定を追加しても過去のコミットには残ります。
ルートの`.gitignore`は、今後の登録を防ぐためのものです。過去の公開分の扱いは、履歴の整理や公開範囲の変更を別途判断してください。

## 公式資料

- [料金と無料枠](https://railway.com/pricing)
- [Trialの期間・データ保持](https://docs.railway.com/pricing/free-trial)
- [Volumeの接続と保存先](https://docs.railway.com/volumes)
- [サブフォルダーにあるアプリの公開](https://docs.railway.com/deployments/monorepo)
- [休止機能](https://docs.railway.com/deployments/serverless)
- [公開HTTPと接続元IPヘッダー](https://docs.railway.com/networking/public-networking/specs-and-limits)
- [旧設定ファイル方式の終了](https://docs.railway.com/config-as-code/reference)
