# weather-notify

その日の **天気・気温・湿度** に加えて、**傘が必要か** / **洗濯物は部屋干し+除湿でよいか**
の判定を、毎朝 **Discord チャンネル**へ自動通知するスクリプト。

- 天気データ: [Open-Meteo](https://open-meteo.com/)（API キー不要）
- 対象地点: **東京都武蔵野市**（固定）
- 実行: **GitHub Actions の cron**（毎朝 7:00 JST）
- 送信: **Discord Webhook**（Bot 不要）・Embed 形式
- LLM は使いません（すべて決定的ロジックで完結）

## 通知内容（Discord Embed）

- 天気（WMO weather_code を日本語化）と絵文字
- 気温（最高 / 最低 / 現在）・湿度（現在）
- 降水確率（日中最大）/ 予想降水量
- ☂️ 傘の要否と理由
- 🧺 洗濯物: 乾きやすさスコア(0-100)・判定（外干し〜部屋干し+除湿）・
  最も乾きやすい時間帯・外干しを避けたい時間帯

判定のしきい値:
- **傘**: 現在降水あり or 降水確率 ≥50% → 必要 / 30–49% → 折りたたみ推奨 / それ未満 → 不要
- **洗濯物（乾きやすさスコア 0-100）**:
  乾きは「気温・湿度・風・日射」で決まり湿度が支配的、という洗濯指数の考え方に基づく。
  蒸発の駆動力である **飽差 VPD（`vapour_pressure_deficit`, kPa）** を主軸に、
  現在時刻以降 24 時間（日中に限定しない）の時間別データを集計してスコア化する。
  - スコア = VPD(最大55) + 風(最大20) + 日射=雲量の裏返し(最大25)
  - 降水ゲート（最優先）: 降水確率 ≥50% or 降水量 ≥1mm → 15以下 / 30–49% → 45以下
  - 高湿度フロア: 湿度 ≥80% → 30以下（生乾き臭防止）
  - 日次スコア = 最も乾く時間帯（上位数時間）の平均＝「一番乾く時間に干す」前提
  - バンド: 75+ よく乾く(外干し推奨) / 60+ 乾く(外干しOK) /
    45+ やや乾きにくい / 25+ 乾きにくい(部屋干し+除湿おすすめ) / それ未満 乾かない(必須)

## セットアップ

### 1. Discord の Webhook URL を作る

対象チャンネル → **⚙ 編集** → **連携サービス（Integrations）** → **ウェブフック** →
**新しいウェブフック** → **ウェブフック URL をコピー**。

### 2. GitHub Secrets に登録する

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で、
- Name: `DISCORD_WEBHOOK_URL`
- Value: 上でコピーした Webhook URL

を登録する。

以上で、毎朝 7:00 JST に自動投稿されます（ワークフロー: `.github/workflows/weather-notify.yml`）。

## ローカルでの動作確認

```bash
cd weather
npm install
DISCORD_WEBHOOK_URL="<あなたの Webhook URL>" npm run notify
```

Discord チャンネルに Embed が届けば OK。型チェックは `npm run typecheck`。

## 手動実行（GitHub 上でのテスト）

リポジトリの **Actions → weather-notify → Run workflow** から手動発火できます
（Secrets 経由で本番同様に Discord へ届きます）。

## スケジュールの変更

GitHub Actions の cron は **UTC** 固定です。JST に 9 時間を足して UTC に直します。
例（`.github/workflows/weather-notify.yml`）:
- 07:00 JST → `cron: "0 22 * * *"`（前日 22:00 UTC）
- 06:00 JST → `cron: "0 21 * * *"`
- 08:00 JST → `cron: "0 23 * * *"`

## 構成

```
weather/
├── package.json
├── tsconfig.json
└── src/
    ├── notify.ts     # 取得 → Discord Embed 構築 → Webhook POST（エントリ）
    └── weather.ts    # Open-Meteo 取得 + 傘/洗濯物(VPDベース乾きやすさスコア) 判定
.github/workflows/weather-notify.yml   # cron（毎朝7:00 JST）+ 手動実行
```
