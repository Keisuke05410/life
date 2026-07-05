# weather-notify

その日の **天気・気温（朝/昼/夜）** と **洗濯物アドバイス** を、毎朝
**1 枚のダッシュボード画像**にして **Discord チャンネル**へ自動通知するスクリプト。

- 天気・気温データ: [Open-Meteo](https://open-meteo.com/)（API キー不要。日本では**気象庁(JMA)モデル**由来）
- 降水確率データ: **気象庁公式**の予報 JSON（東京地方の6時間ブロック。ニュース／tenki.jp と同系統）
- 対象地点: **東京都武蔵野市**（固定）
- 実行: **GitHub Actions の cron**（毎朝 7:00 JST）
- 送信: **Discord Webhook**（Bot 不要）・**画像を直接アップロード**（multipart/form-data）
- 描画: HTML（shadcn/ui 風のダークカード）→ **Playwright(chromium) で PNG 化**
- LLM は使いません（すべて決定的ロジックで完結）

## 通知内容（Discord へ 1 通）

**1 枚のダッシュボード画像**＋**1 行のテキスト要約**を送信します。

画像（**天気予報がメイン**・洗濯物はサブ）:
- 🌅 朝(6-11) / ☀️ 昼(12-17) / 🌙 夜(18-23) の 3 カード（**天気・気温レンジ・降水確率**）を大きく表示
- ヘッダに地点・日付・当日の代表天気・最高／最低気温
- 下部の細いストリップに洗濯物（レベル・スコア・アドバイス／干し時間帯）をサブ表示
- 天気は「その時間帯の最頻（家族単位）」で代表。代表天気は 6-23 時の集約（例「曇り 時々 霧雨」）
- **降水確率は気象庁公式**（東京地方の6時間ブロック）。朝=06時 / 昼=12時 / 夜=18時ブロックを割当。
  過去で欠けた帯や気象庁が取得できない場合は Open-Meteo の平均にフォールバック

テキスト要約（通知プレビュー・検索用の 1 行）:
- 例: `☁️ 東京都武蔵野市 曇り 時々 霧雨 24°/21°・洗濯: 乾きにくい(32)`

判定のしきい値:
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
npx playwright install chromium   # 初回のみ（HTML→PNG 用ブラウザ）

# 画像だけローカルに書き出して見た目を確認（Discord へは送らない）
npm run preview            # ./preview.png を生成
npm run preview -- out.png # 出力先を指定

# 実際に Discord へ 1 通（画像＋1行要約）送る
DISCORD_WEBHOOK_URL="<あなたの Webhook URL>" npm run notify
```

型チェックは `npm run typecheck`。日本語フォントはローカル（macOS の Hiragino 等）で
自動的に使われます。CI では `fonts-noto-cjk` を導入して描画します。

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
    ├── notify.ts     # 取得 → 画像生成 → Webhook へ画像1枚+1行要約を POST（エントリ）
    ├── preview.ts    # 画像をローカルPNGへ書き出す確認用エントリ
    ├── dashboard.ts  # WeatherResult → ダッシュボードHTML（shadcn風ダーク・SVGアイコン）
    ├── render.ts     # HTML → PNG（Playwright/chromium）
    ├── weather.ts    # Open-Meteo 取得 + 朝昼夜サマリ + 洗濯物(VPDベース乾きやすさスコア) 判定
    └── jma.ts        # 気象庁公式JSONから降水確率(東京地方・6時間ブロック)を取得
.github/workflows/weather-notify.yml   # cron（毎朝7:00 JST）+ 手動実行
```

## データソースについて

- **天気・気温**は Open-Meteo。日本の地点では既定(`best_match`)で**気象庁(JMA)モデル**が
  選ばれるため、天気コード・気温は気象庁準拠。時間帯の天気は「最頻（家族単位）」で代表させ、
  一部の時間だけの雨で全体が雨表示になる過大評価を避けている。
- **降水確率**は Open-Meteo だと米GFS由来でニュースより高めに出るため、**気象庁公式の予報JSON**
  （`https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json` の東京地方）に差し替えている。
  これは気象庁サイトが使う JSON で、**公式に「API」として保証されたものではなく仕様変更されうる**点に注意。
  データ自体は気象庁の利用規約上、出典明記で自由に利用できる（キー不要・無料）。取得失敗時は
  Open-Meteo の平均へ自動フォールバックし、通知は止めない。
