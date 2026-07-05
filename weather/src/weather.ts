// Open-Meteo を使った天気取得と、傘・洗濯物の判定ロジック。
// API キー不要。ジオコーディングも Open-Meteo の無料 API を使う。
//
// 洗濯物判定は「飽差 VPD（vapour_pressure_deficit, kPa）」を主軸にした
// 乾きやすさスコア(0-100)で行う。VPD は蒸発（＝乾き）の駆動力で、
// 「湿度が支配的」「室温20℃/湿度40%は28℃/70%より乾く」という洗濯の
// 経験則とも一致する。時間帯を日中に限定せず、現在時刻以降 24 時間の
// 時間別データを対象に、最も乾きやすい時間帯に干す前提で評価する。

/** 既定の対象地点: 東京都武蔵野市 */
const DEFAULT_LOCATION = {
  name: "東京都武蔵野市",
  latitude: 35.7178,
  longitude: 139.5664,
} as const;

export interface Location {
  name: string;
  latitude: number;
  longitude: number;
}

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

/** 朝・昼・夜など、ある時間帯の天気サマリ */
export interface PeriodWeather {
  /** 時間帯ラベル（朝 / 昼 / 夜） */
  label: string;
  /** 代表天気（その時間帯で最も顕著なもの）。データが無ければ null */
  weather: string | null;
  /** 気温レンジ */
  tempMin: number | null;
  tempMax: number | null;
  /** 最大降水確率 */
  precipProbMax: number | null;
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
  periods: { morning: PeriodWeather; afternoon: PeriodWeather; evening: PeriodWeather };
  laundry: LaundryResult;
}

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

function weatherCodeToJa(code: number | null | undefined): string {
  if (code == null) return "不明";
  return WEATHER_CODE_JA[code] ?? `不明 (code ${code})`;
}

/** 雨・雪・雷など「濡れる」天気コードか */
function isWetWeather(code: number | null | undefined): boolean {
  if (code == null) return false;
  // 霧雨/雨/雪/にわか/雷雨 系
  return code >= 51;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** VPD が欠損した時間帯向けのフォールバック（Tetens 式） */
function estimateVpd(tempC: number | null, humidity: number | null): number | null {
  if (tempC == null || humidity == null) return null;
  const es = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3)); // kPa
  return es * (1 - clamp(humidity, 0, 100) / 100);
}

// Open-Meteo のジオコーディングは日本語の略称に弱く（「東京」「京都」「札幌」は0件、
// 「福岡」「横浜」は同名の小集落を誤ヒット）不安定なため、頻出の主要都市は
// エイリアス表で座標を直接解決する。ここに無いものはジオコーディングにフォールバック。
const JAPAN_CITY_ALIASES: Record<
  string,
  { name: string; latitude: number; longitude: number }
> = {
  東京: { name: "東京都", latitude: 35.6895, longitude: 139.6917 },
  東京都: { name: "東京都", latitude: 35.6895, longitude: 139.6917 },
  大阪: { name: "大阪府 大阪市", latitude: 34.6937, longitude: 135.5023 },
  大阪市: { name: "大阪府 大阪市", latitude: 34.6937, longitude: 135.5023 },
  京都: { name: "京都府 京都市", latitude: 35.0116, longitude: 135.7681 },
  京都市: { name: "京都府 京都市", latitude: 35.0116, longitude: 135.7681 },
  名古屋: { name: "愛知県 名古屋市", latitude: 35.1815, longitude: 136.9066 },
  横浜: { name: "神奈川県 横浜市", latitude: 35.4437, longitude: 139.638 },
  札幌: { name: "北海道 札幌市", latitude: 43.0618, longitude: 141.3545 },
  福岡: { name: "福岡県 福岡市", latitude: 33.5904, longitude: 130.4017 },
  神戸: { name: "兵庫県 神戸市", latitude: 34.6901, longitude: 135.1955 },
  仙台: { name: "宮城県 仙台市", latitude: 38.2682, longitude: 140.8694 },
  広島: { name: "広島県 広島市", latitude: 34.3853, longitude: 132.4553 },
  那覇: { name: "沖縄県 那覇市", latitude: 26.2124, longitude: 127.6809 },
  武蔵野: { name: "東京都武蔵野市", latitude: 35.7178, longitude: 139.5664 },
  武蔵野市: { name: "東京都武蔵野市", latitude: 35.7178, longitude: 139.5664 },
};

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country_code?: string;
  population?: number;
}

/** 都市名からジオコーディング。失敗時は null。 */
async function geocode(city: string): Promise<Location | null> {
  // 1) エイリアス表を優先（頻出の主要都市を確実に解決）
  const alias = JAPAN_CITY_ALIASES[city];
  if (alias) return alias;

  // 2) Open-Meteo ジオコーディング。候補を多めに取り、日本国内・人口最大を選ぶ
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", city);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "ja");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: GeoResult[] };
  const results = data.results ?? [];
  if (results.length === 0) return null;

  // 日本国内を優先し、その中で人口最大。日本が無ければ全体で人口最大。
  const jp = results.filter((r) => r.country_code === "JP");
  const pool = jp.length > 0 ? jp : results;
  const best = pool.reduce((a, b) =>
    (b.population ?? 0) > (a.population ?? 0) ? b : a,
  );

  return {
    name: best.admin1 ? `${best.admin1} ${best.name}` : best.name,
    latitude: best.latitude,
    longitude: best.longitude,
  };
}

interface ForecastResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    vapour_pressure_deficit?: number;
    wind_speed_10m?: number;
    cloud_cover?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    vapour_pressure_deficit?: number[];
    wind_speed_10m?: number[];
    precipitation?: number[];
    precipitation_probability?: number[];
    cloud_cover?: number[];
    weather_code?: number[];
  };
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
    precipitation_hours?: number[];
    sunshine_duration?: number[];
  };
}

async function fetchForecast(loc: Location): Promise<ForecastResponse> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(loc.latitude));
  url.searchParams.set("longitude", String(loc.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,precipitation,weather_code,vapour_pressure_deficit,wind_speed_10m,cloud_cover",
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,relative_humidity_2m,vapour_pressure_deficit,wind_speed_10m,precipitation,precipitation_probability,cloud_cover,weather_code",
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,precipitation_hours,sunshine_duration",
  );
  url.searchParams.set("timezone", "Asia/Tokyo");
  // 夜に干して翌朝取り込むケースも賄うため 2 日分取得する。
  url.searchParams.set("forecast_days", "2");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast API エラー: ${res.status}`);
  }
  return (await res.json()) as ForecastResponse;
}

// ---- 朝・昼・夜の天気サマリ ----

/** 各時間帯の定義（時の範囲、両端含む） */
const PERIOD_DEFS: Array<{ key: "morning" | "afternoon" | "evening"; label: string; from: number; to: number }> = [
  { key: "morning", label: "朝", from: 6, to: 11 },
  { key: "afternoon", label: "昼", from: 12, to: 17 },
  { key: "evening", label: "夜", from: 18, to: 23 },
];

/**
 * 当日(現在時刻の日付)の hourly を朝/昼/夜にバケット分けし、各時間帯の
 * 代表天気・気温レンジ・最大降水確率を集計する。
 * hourly が無い場合は current/daily ベースの空サマリ（weather のみ埋める）を返す。
 */
function summarizePeriods(fc: ForecastResponse): WeatherResult["periods"] {
  const h = fc.hourly;
  const times = h?.time;
  const today = (fc.current?.time ?? times?.[0] ?? "").slice(0, 10);

  const build = (def: (typeof PERIOD_DEFS)[number]): PeriodWeather => {
    const empty: PeriodWeather = {
      label: def.label,
      weather: null,
      tempMin: null,
      tempMax: null,
      precipProbMax: null,
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

    // 代表天気: その時間帯で最も顕著なもの（コード最大＝降水/雪系が優先される）
    const weather = codes.length ? weatherCodeToJa(Math.max(...codes)) : null;
    return {
      label: def.label,
      weather,
      tempMin: temps.length ? Math.min(...temps) : null,
      tempMax: temps.length ? Math.max(...temps) : null,
      precipProbMax: probs.length ? Math.max(...probs) : null,
    };
  };

  return {
    morning: build(PERIOD_DEFS[0]),
    afternoon: build(PERIOD_DEFS[1]),
    evening: build(PERIOD_DEFS[2]),
  };
}

// ---- 洗濯物: 乾きやすさスコア ----

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

const avg = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

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
    (avg([...scores].sort((a, b) => b - a).slice(0, topN)) ?? 0),
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
    avgVpd: avg(num(samples.map((s) => s.vpd ?? estimateVpd(s.temp, s.humidity)))),
    avgHumidity: avg(num(samples.map((s) => s.humidity))),
    avgTemp: avg(num(samples.map((s) => s.temp))),
    avgWind: avg(num(samples.map((s) => s.windKmh))),
    avgCloud: avg(num(samples.map((s) => s.cloud))),
    maxProb: samples.length ? Math.max(...num(samples.map((s) => s.precipProb)), 0) : null,
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

const round1 = (v: number | null): number | null =>
  v == null ? null : Math.round(v * 10) / 10;

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
  vpd: number | null,
  temp: number | null,
  humidity: number | null,
  windKmh: number | null,
  cloud: number | null,
  precipNow: number | null,
  probMax: number | null,
  code: number | null,
): LaundryResult {
  const score = computeHourScore({
    time: "",
    vpd,
    temp,
    humidity,
    windKmh,
    cloud,
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

  const weatherCode = fc.daily?.weather_code?.[0] ?? fc.current?.weather_code ?? null;
  const temperatureMax = fc.daily?.temperature_2m_max?.[0] ?? null;
  const temperatureMin = fc.daily?.temperature_2m_min?.[0] ?? null;
  const temperatureNow = fc.current?.temperature_2m ?? null;
  const humidity = fc.current?.relative_humidity_2m ?? null;
  const precipitationProbabilityMax =
    fc.daily?.precipitation_probability_max?.[0] ?? null;
  const precipitationSum = fc.daily?.precipitation_sum?.[0] ?? null;
  const precipitationNow = fc.current?.precipitation ?? null;

  const window = summarizeWindow(fc);
  const laundry = window
    ? judgeLaundryFromWindow(window)
    : judgeLaundryFallback(
        fc.current?.vapour_pressure_deficit ?? null,
        temperatureNow,
        humidity,
        fc.current?.wind_speed_10m ?? null,
        fc.current?.cloud_cover ?? null,
        precipitationNow,
        precipitationProbabilityMax,
        weatherCode,
      );

  return {
    location: loc.name,
    weather: weatherCodeToJa(weatherCode),
    temperatureMax,
    temperatureMin,
    temperatureNow,
    humidity,
    precipitationProbabilityMax,
    precipitationSum,
    precipitationNow,
    periods: summarizePeriods(fc),
    laundry,
  };
}

/** 人間が読みやすい日本語テキストへ整形 */
export function formatWeather(r: WeatherResult): string {
  const fmtTemp = (v: number | null) => (v == null ? "—" : `${v}℃`);
  const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`);
  const fmtMm = (v: number | null) => (v == null ? "—" : `${v}mm`);

  const fmtRange = (p: PeriodWeather) =>
    p.tempMin == null || p.tempMax == null
      ? "—"
      : `${Math.round(p.tempMin)}〜${Math.round(p.tempMax)}℃`;
  const fmtPeriod = (p: PeriodWeather) =>
    `${p.label}: ${p.weather ?? "—"} / ${fmtRange(p)} / 降水 ${fmtPct(
      p.precipProbMax,
    )}`;

  const lines = [
    `【${r.location} の今日の天気】`,
    ``,
    `天気: ${r.weather}`,
    `気温: 最高 ${fmtTemp(r.temperatureMax)} / 最低 ${fmtTemp(
      r.temperatureMin,
    )}（現在 ${fmtTemp(r.temperatureNow)}）`,
    fmtPeriod(r.periods.morning),
    fmtPeriod(r.periods.afternoon),
    fmtPeriod(r.periods.evening),
    ``,
    `🧺 洗濯物: ${r.laundry.advice}`,
    `   乾きやすさ ${r.laundry.index}/100（${r.laundry.level}）`,
    `   ${r.laundry.reason}`,
  ];
  if (r.laundry.bestWindow) {
    lines.push(`   ⏰ 最も乾きやすい時間帯: ${r.laundry.bestWindow}`);
  }
  if (r.laundry.avoidHours) {
    lines.push(`   ☔ 外干しを避けたい時間帯: ${r.laundry.avoidHours}`);
  }
  return lines.join("\n");
}
