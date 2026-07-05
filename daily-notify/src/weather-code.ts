// WMO weather_code の日本語化と「家族(family)」分類。
//
// 時間帯の代表天気は「最悪の1時間(Math.max)」ではなく、家族単位の最頻で決める。
// これにより「昼は霧雨1時間だけなのに弱い霧雨」「深夜の最悪コードでタイトルが強い霧雨」
// といった過度に雨寄りの表示を避け、tenki.jp/気象庁の「曇り時々雨」的な表現に近づける。

/** WMO weather_code -> 日本語ラベル */
const WEATHER_CODE_JA: Record<number, string> = {
  0: "快晴",
  1: "晴れ",
  2: "一部曇り",
  3: "曇り",
  45: "霧",
  48: "着氷性の霧",
  51: "弱い霧雨",
  53: "霧雨",
  55: "強い霧雨",
  56: "弱い着氷性の霧雨",
  57: "着氷性の霧雨",
  61: "弱い雨",
  63: "雨",
  65: "強い雨",
  66: "弱い着氷性の雨",
  67: "着氷性の雨",
  71: "弱い雪",
  73: "雪",
  75: "強い雪",
  77: "霧雪",
  80: "弱いにわか雨",
  81: "にわか雨",
  82: "激しいにわか雨",
  85: "弱いにわか雪",
  86: "にわか雪",
  95: "雷雨",
  96: "雹を伴う雷雨",
  99: "激しい雹を伴う雷雨",
};

export function weatherCodeToJa(code: number | null | undefined): string {
  if (code == null) return "不明";
  return WEATHER_CODE_JA[code] ?? `不明 (code ${code})`;
}

/** 雨・雪・雷など「濡れる」天気コードか */
export function isWetWeather(code: number | null | undefined): boolean {
  if (code == null) return false;
  // 霧雨/雨/雪/にわか/雷雨 系
  return code >= 51;
}

export type WeatherFamily =
  | "clear"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

/** 軽い→重い の順（同数タイのとき重い家族を代表に選ぶための順序） */
export const FAMILY_SEVERITY: WeatherFamily[] = [
  "clear",
  "cloud",
  "fog",
  "drizzle",
  "rain",
  "snow",
  "thunder",
];

export const FAMILY_LABEL: Record<WeatherFamily, string> = {
  clear: "晴れ",
  cloud: "曇り",
  fog: "霧",
  drizzle: "霧雨",
  rain: "雨",
  snow: "雪",
  thunder: "雷雨",
};

function codeFamily(code: number): WeatherFamily {
  if (code <= 1) return "clear"; // 0 快晴 / 1 晴れ
  if (code <= 3) return "cloud"; // 2 一部曇り / 3 曇り
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle"; // 霧雨系
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "cloud";
}

/** コード群を家族ごとに数える */
export function familyCounts(codes: number[]): Map<WeatherFamily, number> {
  const m = new Map<WeatherFamily, number>();
  for (const c of codes) {
    const f = codeFamily(c);
    m.set(f, (m.get(f) ?? 0) + 1);
  }
  return m;
}

/** 最多家族（同数なら重い家族）を返す。空なら null。 */
export function dominantFamily(codes: number[]): WeatherFamily | null {
  if (codes.length === 0) return null;
  const counts = familyCounts(codes);
  let best: WeatherFamily | null = null;
  let bestCount = -1;
  // 軽い→重い順に走査し、同数のとき後勝ち＝重い家族を採用
  for (const f of FAMILY_SEVERITY) {
    const cnt = counts.get(f) ?? 0;
    if (cnt > 0 && cnt >= bestCount) {
      best = f;
      bestCount = cnt;
    }
  }
  return best;
}

/** 時間帯の代表天気ラベル（家族単位）。空なら null。 */
export function representativeWeatherLabel(codes: number[]): string | null {
  const fam = dominantFamily(codes);
  return fam ? FAMILY_LABEL[fam] : null;
}
