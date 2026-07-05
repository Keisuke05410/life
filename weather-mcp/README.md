# weather-mcp

その日の **天気・気温・湿度** に加えて、**傘が必要か** / **洗濯物は部屋干し+除湿でよいか**
の判定を返すリモート MCP サーバー。TypeScript + Cloudflare Workers 製で、
claude.ai のカスタムコネクタから利用できます。

- 天気データ: [Open-Meteo](https://open-meteo.com/)（API キー不要）
- 既定の対象地点: **東京都武蔵野市**（`city` パラメータで別都市も指定可能）
- トランスポート: Streamable HTTP（エンドポイント `/mcp`）

## 提供ツール

### `get_today_weather`
| 入力 | 型 | 説明 |
| --- | --- | --- |
| `city` | string（任意） | 天気を調べたい都市名。省略時は東京都武蔵野市。 |

返却（日本語テキスト）:
- 天気（WMO weather_code を日本語化）
- 気温（最高 / 最低 / 現在）
- 湿度（現在）
- 降水確率（日中最大）/ 予想降水量
- ☂️ 傘の要否と理由
- 🧺 洗濯物（部屋干し+除湿 or 外干しOK）と理由

判定のしきい値:
- **傘**: 現在降水あり or 降水確率 ≥50% → 必要 / 30–49% → 折りたたみ推奨 / それ未満 → 不要
- **洗濯物**: 雨（予報含む）or 降水確率 ≥50% → 部屋干し+除湿 / 湿度 ≥70% or 降水確率 ≥30% → 部屋干し無難 / それ以外 → 外干しOK

## セットアップ

```bash
cd weather-mcp
npm install
```

## ローカル起動

```bash
npm run dev
```

`http://localhost:8787/mcp` で待ち受けます。動作確認は MCP Inspector が手軽です:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP / URL: http://localhost:8787/mcp
# initialize → tools/list → get_today_weather を実行
```

## デプロイ（Cloudflare Workers）

```bash
npx wrangler login      # 初回のみ
npm run deploy
```

デプロイ後、`https://weather-mcp.<your-subdomain>.workers.dev/mcp` が公開 URL になります。

## claude.ai への登録

1. claude.ai → 設定 → **コネクタ** → **カスタムコネクタを追加**
2. MCP サーバー URL に上記 `.../mcp` を入力して追加
3. チャットで「今日の天気は？」「傘いる？」「洗濯物どうする？」などと聞くと
   `get_today_weather` が呼ばれます。

## 構成

```
weather-mcp/
├── package.json
├── tsconfig.json
├── wrangler.jsonc     # Workers 設定 + Durable Object(SQLite)
└── src/
    ├── index.ts       # McpAgent 実装・ツール登録・エントリ
    └── weather.ts     # Open-Meteo 取得 + 傘/洗濯物 判定
```
