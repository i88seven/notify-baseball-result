# notify-baseball-result

高校野球の試合結果をSlackに通知するスクリプトです。指定された高校の試合情報を取得し、Slackチャンネルに通知します。

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env`ファイルを作成し、以下の環境変数を設定してください：

```bash
GAS_API_URL=your_gas_api_url
GAS_API_KEY=your_gas_api_key
SLACK_WEBHOOK_URL=your_slack_webhook_url
```

### 3. Google Apps Scriptの設定

監視対象の高校リストを返すGoogle Apps Scriptを作成してください。
レスポンス形式：

```json
[
  {
    "teamName": "○○高校",
    "prefectureKey": "etokyo",
    "prefectureName": "東東京"
  }
]
```

## 実行手順

```bash
npm run start
```

## 技術スタック

- Node.js
- TypeScript
- axios (HTTP通信)
- dotenv (環境変数管理)
