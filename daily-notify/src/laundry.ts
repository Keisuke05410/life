// 洗濯物の「乾きやすさ」判定ロジック。
//
// 「飽差 VPD（vapour_pressure_deficit, kPa）」を主軸にした乾きやすさスコア(0-100)で
// 判定する。VPD は蒸発（＝乾き）の駆動力で、「湿度が支配的」「室温20℃/湿度40%は
// 28℃/70%より乾く」という洗濯の経験則とも一致する。時間帯を日中に限定せず、
// 現在時刻以降 24 時間の時間別データを対象に、最も乾きやすい時間帯に干す前提で評価する。

import { avg, clamp, round1 } from "./lib.js";
import type { ForecastResponse } from "./open-meteo.js";
import { isWetWeather } from "./weather-code.js";

export interface LaundryResult {
  /** 乾きやすさスコア 0-100（対象時間帯の代表値） */
  index: number;
  /** バンド名（よく乾く / 乾く / やや乾きにくい / 乾きにくい / 乾かない） */
  level: string;
  /** 行動指針（外干し推奨 / 部屋干し+除湿 など） */
  advice: string;
  /** 判定根拠（VPD・湿度・風・雲量・降水） */
  reason: string;
  /** 最も乾きやすい時間帯（外干し前提） */
  bestWindow?: string;
  /** 雨などで外干しを避けたい時間帯 */
  avoidHours?: string;
}

/** VPD が欠損した時間帯向けのフォールバック（Tetens 式） */
function estimateVpd(
  tempC: number | null,
  humidity: number | null,
): number | null {
  if (tempC == null || humidity == null) return null;
  const es = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3)); // kPa
  return es * (1 - clamp(humidity, 0, 100) / 100);
}

interface HourSample {
  time: string;
  vpd: number | null;
  windKmh: number | null;
  cloud: number | null;
  precip: number | null;
  precipProb: number | null;
  humidity: number | null;
  temp: number | null;
}

/**
 * 1 時間あたりの乾きやすさスコア(0-100)。
 * VPD(蒸発の駆動力)を主軸に、風・日射(雲量の裏返し)で加点し、
 * 降水を最優先ゲート、高湿度をフロアとして制限する。
 */
function computeHourScore(h: HourSample): number {
  const vpd = h.vpd ?? estimateVpd(h.temp, h.humidity) ?? 0.3;
  const windKmh = h.windKmh ?? 0;
  const cloud = h.cloud ?? 50;

  // VPD: 0.2kPa で 0 点、1.3kPa で 55 点（20℃/50%≈1.17kPa が好条件）
  const vpdScore = clamp(((vpd - 0.2) / (1.3 - 0.2)) * 55, 0, 55);
  // 風: 20km/h で満点（表面の湿った空気を飛ばす）
  const windScore = clamp((windKmh / 20) * 20, 0, 20);
  // 日射: 雲量が少ないほど高得点（夜間は日射がなく自然に低スコア）
  const sunScore = clamp(((100 - cloud) / 100) * 25, 0, 25);

  let score = vpdScore + windScore + sunScore;

  // 降水ゲート（最優先）
  const prob = h.precipProb ?? 0;
  const precip = h.precip ?? 0;
  if (prob >= 50 || precip >= 1) {
    score = Math.min(score, 15);
  } else if (prob >= 30) {
    score = Math.min(score, 45);
  }
  // 高湿度フロア（生乾き臭防止）
  if ((h.humidity ?? 0) >= 80) {
    score = Math.min(score, 30);
  }

  return clamp(score, 0, 100);
}

/** hourly.time("YYYY-MM-DDTHH:MM") から「H時」ラベル。基準日より後なら「翌」。 */
function hourLabel(time: string, baseDate: string): string {
  const date = time.slice(0, 10);
  const hour = Number(time.slice(11, 13));
  return `${date > baseDate ? "翌" : ""}${hour}時`;
}

/** マスクが true の連続ブロックを [first,last] の配列で返す */
function contiguousBlocks(mask: boolean[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start === -1) start = i;
    if (!mask[i] && start !== -1) {
      blocks.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) blocks.push([start, mask.length - 1]);
  return blocks;
}

/** [first,last] のブロックを「開始時〜終了時」ラベルに整形 */
function formatBlock(
  times: string[],
  baseDate: string,
  first: number,
  last: number,
): string {
  const startLabel = hourLabel(times[first], baseDate);
  // 終了は最後のスロットの 1 時間後を境界とする
  const lastDate = times[last].slice(0, 10);
  let endHour = Number(times[last].slice(11, 13)) + 1;
  let endPrefix = lastDate > baseDate ? "翌" : "";
  if (endHour === 24) {
    endHour = 0;
    endPrefix = "翌";
  }
  return `${startLabel}〜${endPrefix}${endHour}時`;
}

interface WindowSummary {
  index: number;
  avgVpd: number | null;
  avgHumidity: number | null;
  avgTemp: number | null;
  avgWind: number | null;
  avgCloud: number | null;
  maxProb: number | null;
  sumPrecip: number | null;
  bestWindow?: string;
  avoidHours?: string;
}

/**
 * 現在時刻以降 24 時間の時間別データを集計して洗濯サマリを作る。
 * hourly が無い場合は null を返し、呼び出し側で current にフォールバックする。
 */
function summarizeWindow(fc: ForecastResponse): WindowSummary | null {
  const h = fc.hourly;
  const times = h?.time;
  if (!h || !times || times.length === 0) return null;

  // 現在時刻の「時」から開始インデックスを決める
  const nowPrefix = (fc.current?.time ?? times[0]).slice(0, 13);
  let startIdx = times.findIndex((t) => t.slice(0, 13) >= nowPrefix);
  if (startIdx === -1) startIdx = 0;
  const endIdx = Math.min(times.length, startIdx + 24);

  const samples: HourSample[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    samples.push({
      time: times[i],
      vpd: h.vapour_pressure_deficit?.[i] ?? null,
      windKmh: h.wind_speed_10m?.[i] ?? null,
      cloud: h.cloud_cover?.[i] ?? null,
      precip: h.precipitation?.[i] ?? null,
      precipProb: h.precipitation_probability?.[i] ?? null,
      humidity: h.relative_humidity_2m?.[i] ?? null,
      temp: h.temperature_2m?.[i] ?? null,
    });
  }
  if (samples.length === 0) return null;

  const scores = samples.map(computeHourScore);
  const windowTimes = samples.map((s) => s.time);
  const baseDate = windowTimes[0].slice(0, 10);

  // 日次インデックス = 上位スコア時間帯の平均（最も乾く時間に干す前提）
  const topN = Math.min(6, scores.length);
  const dayIndex = Math.round(
    avg([...scores].sort((a, b) => b - a).slice(0, topN)) ?? 0,
  );

  // 一番乾きやすい時間帯: 最高スコア地点を中心に、しきい値以上の連続帯を抽出
  const maxScore = Math.max(...scores);
  let bestWindow: string | undefined;
  if (maxScore >= 45) {
    const threshold = Math.max(45, maxScore - 12);
    const peak = scores.indexOf(maxScore);
    let lo = peak;
    let hi = peak;
    while (lo - 1 >= 0 && scores[lo - 1] >= threshold) lo--;
    while (hi + 1 < scores.length && scores[hi + 1] >= threshold) hi++;
    bestWindow = formatBlock(windowTimes, baseDate, lo, hi);
  }

  // 外干しを避けたい時間帯: 降水ゲートが立つ時間の連続帯
  const rainMask = samples.map(
    (s) => (s.precipProb ?? 0) >= 50 || (s.precip ?? 0) >= 1,
  );
  const rainBlocks = contiguousBlocks(rainMask);
  const avoidHours =
    rainBlocks.length === 0
      ? undefined
      : rainBlocks
          .map(([a, b]) => formatBlock(windowTimes, baseDate, a, b))
          .join("、");

  const num = (xs: Array<number | null>): number[] =>
    xs.filter((x): x is number => x != null);

  return {
    index: dayIndex,
    avgVpd: avg(
      num(samples.map((s) => s.vpd ?? estimateVpd(s.temp, s.humidity))),
    ),
    avgHumidity: avg(num(samples.map((s) => s.humidity))),
    avgTemp: avg(num(samples.map((s) => s.temp))),
    avgWind: avg(num(samples.map((s) => s.windKmh))),
    avgCloud: avg(num(samples.map((s) => s.cloud))),
    maxProb: samples.length
      ? Math.max(...num(samples.map((s) => s.precipProb)), 0)
      : null,
    sumPrecip: num(samples.map((s) => s.precip)).reduce((a, b) => a + b, 0),
    bestWindow,
    avoidHours,
  };
}

/** スコア → バンド（level / advice） */
function scoreToBand(index: number): { level: string; advice: string } {
  if (index >= 75)
    return { level: "よく乾く", advice: "外干し推奨（部屋干し+除湿は不要）" };
  if (index >= 60) return { level: "乾く", advice: "外干しOK" };
  if (index >= 45)
    return {
      level: "やや乾きにくい",
      advice: "外干し可（早め取り込み・風通しを）。部屋干し+除湿でも可",
    };
  if (index >= 25)
    return { level: "乾きにくい", advice: "部屋干し+除湿がおすすめ" };
  return { level: "乾かない", advice: "部屋干し+除湿が必須（外干し不可）" };
}

/** 対象時間帯サマリから洗濯判定を組み立てる */
function judgeLaundryFromWindow(w: WindowSummary): LaundryResult {
  const band = scoreToBand(w.index);
  const parts: string[] = [];
  if (w.avgVpd != null) parts.push(`VPD ${round1(w.avgVpd)}kPa`);
  if (w.avgHumidity != null) parts.push(`湿度 ${Math.round(w.avgHumidity)}%`);
  if (w.avgTemp != null) parts.push(`気温 ${Math.round(w.avgTemp)}℃`);
  if (w.avgWind != null) parts.push(`風 ${Math.round(w.avgWind)}km/h`);
  if (w.avgCloud != null) parts.push(`雲量 ${Math.round(w.avgCloud)}%`);
  let reason = `今後24時間平均: ${parts.join(" / ")}。`;
  if ((w.maxProb ?? 0) >= 30 || (w.sumPrecip ?? 0) >= 1) {
    reason += ` 降水確率 最大${Math.round(w.maxProb ?? 0)}% / 予想降水量 ${round1(
      w.sumPrecip,
    )}mm。`;
  }
  return {
    index: w.index,
    level: band.level,
    advice: band.advice,
    reason,
    bestWindow: w.bestWindow,
    avoidHours: w.avoidHours,
  };
}

/** hourly が使えない場合の current ベースのフォールバック判定 */
function judgeLaundryFallback(
  fc: ForecastResponse,
  probMax: number | null,
  code: number | null,
): LaundryResult {
  const vpd = fc.current?.vapour_pressure_deficit ?? null;
  const temp = fc.current?.temperature_2m ?? null;
  const humidity = fc.current?.relative_humidity_2m ?? null;
  const precipNow = fc.current?.precipitation ?? null;
  const score = computeHourScore({
    time: "",
    vpd,
    temp,
    humidity,
    windKmh: fc.current?.wind_speed_10m ?? null,
    cloud: fc.current?.cloud_cover ?? null,
    precip: (precipNow ?? 0) > 0.1 || isWetWeather(code) ? 2 : 0,
    precipProb: probMax,
  });
  const index = Math.round(score);
  const band = scoreToBand(index);
  const parts: string[] = [];
  const v = vpd ?? estimateVpd(temp, humidity);
  if (v != null) parts.push(`VPD ${round1(v)}kPa`);
  if (humidity != null) parts.push(`湿度 ${Math.round(humidity)}%`);
  if (temp != null) parts.push(`気温 ${Math.round(temp)}℃`);
  return {
    index,
    level: band.level,
    advice: band.advice,
    reason: `現在の条件（${parts.join(" / ")}）による簡易判定です。`,
  };
}

/**
 * 予報データから洗濯判定を返す。hourly があれば今後 24 時間の集計で、
 * 無ければ current ベースの簡易判定にフォールバックする。
 */
export function judgeLaundry(
  fc: ForecastResponse,
  probMax: number | null,
  weatherCode: number | null,
): LaundryResult {
  const window = summarizeWindow(fc);
  return window
    ? judgeLaundryFromWindow(window)
    : judgeLaundryFallback(fc, probMax, weatherCode);
}
