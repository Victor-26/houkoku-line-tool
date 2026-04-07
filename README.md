# 日経ニュース LINE通知ツール

日経電子版のRSSから記事を取得し、**Claude AIがあなたのプロフィールに合わせて選別**してLINEに朝7:30に通知します。

## 仕組み

```
[日経電子版 RSS]
      ↓ 記事取得（過去24時間）
[Claude AI フィルタリング]
      ↓ スコアリング・要約
[LINE Messaging API]
      ↓ 毎朝7:30 JST（平日）
[あなたのLINE]
```

## セットアップ手順

### 1. リポジトリを GitHub に作成・プッシュ

```bash
cd /path/to/nikkei-line-tool
git remote add origin https://github.com/YOUR_USERNAME/nikkei-line-tool.git
git add .
git commit -m "初期構築"
git push -u origin main
```

### 2. Claude API キーを取得

[Anthropic Console](https://console.anthropic.com/) でAPIキーを発行します。

### 3. LINE Messaging API を設定

1. [LINE Developers](https://developers.line.biz/) にアクセス
2. **新しいプロバイダー**を作成
3. **Messaging API チャンネル**を作成
4. チャンネル設定 → **チャンネルアクセストークン（長期）** を発行
5. 自分の LINE User ID を確認する方法:
   - 作成した Bot を友だち追加する
   - Bot に任意のメッセージを送る
   - Webhook で受信した `source.userId` を控える
   - ※簡単な確認方法: [LINE の公式ドキュメント](https://developers.line.biz/ja/reference/messaging-api/#get-profile) 参照

### 4. GitHub Secrets を設定

GitHub リポジトリの **Settings → Secrets and variables → Actions** で以下を追加:

| シークレット名 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude の APIキー |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャンネルアクセストークン |
| `LINE_USER_ID` | 通知先の LINE User ID（`U` から始まる文字列）|

### 5. カスタマイズ

`config.yml` を編集してプロフィールやフィルタ条件を調整できます:

```yaml
user_profile:
  role: "中小企業の経営者"
  industry: "製造業"
  interests:
    - "製造業・ものづくりに関するトレンド"
    # ... 追加・変更可能
```

### 6. 動作確認（ローカル）

```bash
# 依存関係インストール
npm install

# .env ファイルを作成
cp .env.example .env
# .env に各種キーを記入

# テスト実行
node scripts/main.js
```

### 7. 手動で GitHub Actions を実行

リポジトリの **Actions** タブ → `毎朝ニュース通知` → **Run workflow**

## LINEに届くメッセージの例

```
📰 今日の注目ニュース
2026年4月7日（火）

【1】★★★★☆
鉄鋼・金属材料が大幅値上がり、製造コスト見直しが急務
📌 原材料費直撃のため即時対応が必要
🔗 https://www.nikkei.com/article/...

【2】★★★★☆
中小企業の設備投資補助金が拡充、新制度の詳細を確認
📌 設備投資補助が拡充、申請期間を要確認
🔗 https://www.nikkei.com/article/...

─────────────
Powered by Nikkei × Claude
```

## GitHub Secrets 一覧

| シークレット名 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 認証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot 認証 |
| `LINE_USER_ID` | 通知先 LINE User ID |
