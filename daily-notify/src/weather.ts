// 当日の天気サマリを組み立てるオーケストレータ。
// 座標解決は geocode.ts、予報取得は open-meteo.ts、天気コード分類は weather-code.ts、
// 洗濯判定は laundry.ts、降水確率の補完は jma.ts に分割してある。

import { DEFAULT_LOCATION, geocode, type Location } from "./geocode.js";
import { fetchJmaPops, type JmaPops } from "./jma.js";
import { judgeLaundry, type LaundryResult } from "./laundry.js";
import { PERIOD_DEFS, type PeriodDef } from "./lib.js";
import { type ForecastResponse, fetchForecast } from "./open-meteo.js";
import {
  dominantFamily,
  FAMILY_LABEL,
  FAMILY_SEVERITY,
  familyCounts,
  representativeWeatherLabel,
  type WeatherFamily,
  weatherCodeToJa,
} from "./weather-code.js";

export type { LaundryResult } from "./laundry.js";

/** 朝・昼・夜など、ある時間帯の天気サマリ */
export interface PeriodWeather {
  /** 時間帯ラベル（朝 / 昼 / 夜） */
  label: string;
  /** 代表天気（その時間帯で最も顕著なもの）。データが無ければ null */
  weather: string | null;
  /** 気温レンジ */
  tempMin: number | null;
  tempMax: number | null;
  /** 降水確率(%)。気象庁の6時間ブロック値。無ければ Open-Meteo の平均。 */
  precipProb: number | null;
}

export interface WeatherResult {
  location: string;
  weather: string;
  temperatureMax: number | null;
  temperatureMin: number | null;
  temperatureNow: number | null;
  humidity: number | null;
  precipitationProbabilityMax: number | null;
  precipitationSum: number | null;
  precipitationNow: number | null;
  /** 朝(6-11)/昼(12-17)/夜(18-23) の時間帯別サマリ */
  periods: {
    morning: PeriodWeather;
    afternoon: PeriodWeather;
    evening: PeriodWeather;
  };
  laundry: LaundryResult;
}

/**
 * 当日(現在時刻の日付)の hourly を朝/昼/夜にバケット分けし、各時間帯の
 * 代表天気・気温レンジ・降水確率を集計する。
 * - 天気: 家族単位の最頻（Math.max による「最悪の1時間」ではない）。
 * - 降水確率: 気象庁の6時間ブロック値を最優先。無ければ Open-Meteo の平均。
 * hourly が無い場合は空サマリ（すべて null）を返す。
 */
function summarizePeriods(
  fc: ForecastResponse,
  jmaPops: JmaPops | null,
): WeatherResult["periods"] {
  const h = fc.hourly;
  const times = h?.time;
  const today = (fc.current?.time ?? times?.[0] ?? "").slice(0, 10);

  const build = (def: PeriodDef): PeriodWeather => {
    const empty: PeriodWeather = {
      label: def.label,
      weather: null,
      tempMin: null,
      tempMax: null,
      precipProb: null,
    };
    if (!h || !times) return empty;

    const codes: number[] = [];
    const temps: number[] = [];
    const probs: number[] = [];
    for (let i = 0; i < times.length; i++) {
      if (times[i].slice(0, 10) !== today) continue;
      const hour = Number(times[i].slice(11, 13));
      if (hour < def.from || hour > def.to) continue;
      const c = h.weather_code?.[i];
      if (c != null) codes.push(c);
      const t = h.temperature_2m?.[i];
      if (t != null) temps.push(t);
      const p = h.precipitation_probability?.[i];
      if (p != null) probs.push(p);
    }

    // 降水確率: 気象庁の該当ブロック（開始時=def.from）を最優先、無ければ Open-Meteo 平均
    const jma = jmaPops?.byStartHour[def.from];
    const omMean = probs.length
      ? Math.round(probs.reduce((a, b) => a + b, 0) / probs.length)
      : null;
    const precipProb = jma != null ? jma : omMean;

    return {
      label: def.label,
      weather: representativeWeatherLabel(codes),
      tempMin: temps.length ? Math.min(...temps) : null,
      tempMax: temps.length ? Math.max(...temps) : null,
      precipProb,
    };
  };

  return {
    morning: build(PERIOD_DEFS[0]),
    afternoon: build(PERIOD_DEFS[1]),
    evening: build(PERIOD_DEFS[2]),
  };
}

/**
 * タイトル用の当日代表天気。6-23時の hourly から主家族を選び、
 * 副家族が全体の25%以上あれば「主 時々 副」に整形する（例「曇り 時々 霧雨」）。
 * hourly が無ければ null。
 */
function dayRepresentativeWeather(
  fc: ForecastResponse,
  today: string,
): string | null {
  const h = fc.hourly;
  const times = h?.time;
  if (!h || !times || !h.weather_code) return null;

  const codes: number[] = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i].slice(0, 10) !== today) continue;
    const hour = Number(times[i].slice(11, 13));
    if (hour < 6 || hour > 23) continue;
    const c = h.weather_code[i];
    if (c != null) codes.push(c);
  }
  if (codes.length === 0) return null;

  const mainFam = dominantFamily(codes);
  if (!mainFam) return null;
  const counts = familyCounts(codes);

  // 副家族: 主家族以外で最多（同数なら重い家族）
  let subFam: WeatherFamily | null = null;
  let subCount = 0;
  for (const f of FAMILY_SEVERITY) {
    if (f === mainFam) continue;
    const cnt = counts.get(f) ?? 0;
    if (cnt > 0 && cnt >= subCount) {
      subFam = f;
      subCount = cnt;
    }
  }

  const mainLabel = FAMILY_LABEL[mainFam];
  if (subFam && subCount / codes.length >= 0.25) {
    return `${mainLabel} 時々 ${FAMILY_LABEL[subFam]}`;
  }
  return mainLabel;
}

/**
 * 対象地点の当日の天気サマリと、傘・洗濯物の判定を返す。
 * @param city 省略時は東京都武蔵野市
 */
export async function getTodayWeather(city?: string): Promise<WeatherResult> {
  let loc: Location = DEFAULT_LOCATION;
  if (city && city.trim() !== "") {
    const geo = await geocode(city.trim());
    if (!geo) {
      throw new Error(
        `「${city}」の位置情報が見つかりませんでした。都市名を確認してください。`,
      );
    }
    loc = geo;
  }

  const fc = await fetchForecast(loc);
  const today = (fc.current?.time ?? fc.hourly?.time?.[0] ?? "").slice(0, 10);
  // 降水確率は気象庁公式から（東京地方の6時間ブロック）。失敗時は null → Open-Meteo にフォールバック。
  const jmaPops = await fetchJmaPops(today);

  const weatherCode =
    fc.daily?.weather_code?.[0] ?? fc.current?.weather_code ?? null;
  const precipitationProbabilityMax =
    fc.daily?.precipitation_probability_max?.[0] ?? null;

  return {
    location: loc.name,
    // タイトルの天気は 6-23時の代表（「曇り 時々 霧雨」等）。hourly が無ければ daily コード。
    weather:
      dayRepresentativeWeather(fc, today) ?? weatherCodeToJa(weatherCode),
    temperatureMax: fc.daily?.temperature_2m_max?.[0] ?? null,
    temperatureMin: fc.daily?.temperature_2m_min?.[0] ?? null,
    temperatureNow: fc.current?.temperature_2m ?? null,
    humidity: fc.current?.relative_humidity_2m ?? null,
    precipitationProbabilityMax,
    precipitationSum: fc.daily?.precipitation_sum?.[0] ?? null,
    precipitationNow: fc.current?.precipitation ?? null,
    periods: summarizePeriods(fc, jmaPops),
    laundry: judgeLaundry(fc, precipitationProbabilityMax, weatherCode),
  };
}
