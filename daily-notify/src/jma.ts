// 気象庁(JMA)公式の予報JSONから、降水確率(6時間ブロック)を取得する。
//
// これは気象庁サイトが内部で使っている JSON で、公式に「API」として保証された
// ものではなく、予告なく仕様変更されうる。データ自体は気象庁の利用規約上、
// 出典を明記すれば自由に利用・複製・再配布できる（キー/認証不要・無料）。
//
// エリアコード: 東京都 = 130000、東京地方 = 130010（武蔵野市はここに属する）。
// Open-Meteo の天気コード・気温はすでに気象庁モデル由来なので流用し、
// 気象庁が「モデルとして」提供しない降水確率だけをここで補う。

import { fetchWithTimeout } from "./lib.js";

const JMA_FORECAST_URL =
  "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json";
/** 東京地方（武蔵野市を含む一次細分区域） */
const TOKYO_AREA_CODE = "130010";
const TOKYO_AREA_NAME = "東京地方";

/** 今日の降水確率（6時間ブロック開始時刻 → %）。 */
export interface JmaPops {
  /** 開始時（0/6/12/18 など）→ 降水確率(%)。今日の分のみ。 */
  byStartHour: Record<number, number>;
}

interface JmaArea {
  area: { name: string; code: string };
  pops?: string[];
}
interface JmaTimeSeries {
  timeDefines: string[];
  areas: JmaArea[];
}
interface JmaForecast {
  timeSeries?: JmaTimeSeries[];
}

function isTokyoArea(a: JmaArea): boolean {
  return (
    a.pops != null &&
    (a.area.code === TOKYO_AREA_CODE || a.area.name === TOKYO_AREA_NAME)
  );
}

/**
 * 気象庁の東京地方の降水確率を取得する。
 * @param today "YYYY-MM-DD"（Asia/Tokyo）。この日付のブロックだけを拾う。
 * @returns 取得できなければ null（呼び出し側で Open-Meteo にフォールバック）。
 */
export async function fetchJmaPops(today: string): Promise<JmaPops | null> {
  try {
    const res = await fetchWithTimeout(JMA_FORECAST_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as JmaForecast[];
    const short = data?.[0];
    if (!short?.timeSeries) return null;

    // pops を持つ東京地方の timeSeries を探す
    const series = short.timeSeries.find((s) => s.areas.some(isTokyoArea));
    const area = series?.areas.find(isTokyoArea);
    if (!series || !area?.pops) return null;

    const byStartHour: Record<number, number> = {};
    for (let i = 0; i < series.timeDefines.length; i++) {
      const t = series.timeDefines[i]; // 例 "2026-07-05T12:00:00+09:00"
      if (t.slice(0, 10) !== today) continue; // 今日のブロックのみ
      const hour = Number(t.slice(11, 13));
      const raw = area.pops[i];
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) byStartHour[hour] = n;
    }

    return Object.keys(byStartHour).length > 0 ? { byStartHour } : null;
  } catch (err) {
    // ネットワーク/パース失敗時は null で Open-Meteo にフォールバック（通知は止めない）
    console.warn(
      "気象庁の降水確率の取得に失敗しました（Open-Meteo にフォールバック）:",
      err,
    );
    return null;
  }
}
