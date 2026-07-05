// Open-Meteo を使った天気取得と、傘・洗濯物の判定ロジック。
// API キー不要。ジオコーディングも Open-Meteo の無料 API を使う。

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
  umbrella: { needed: string; reason: string };
  laundry: { advice: string; reason: string };
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
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
  };
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
  };
}

async function fetchForecast(loc: Location): Promise<ForecastResponse> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(loc.latitude));
  url.searchParams.set("longitude", String(loc.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,precipitation,weather_code",
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
  );
  url.searchParams.set("timezone", "Asia/Tokyo");
  url.searchParams.set("forecast_days", "1");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast API エラー: ${res.status}`);
  }
  return (await res.json()) as ForecastResponse;
}

/** 傘の要否を判定 */
function judgeUmbrella(
  probMax: number | null,
  precipNow: number | null,
  code: number | null,
): { needed: string; reason: string } {
  const prob = probMax ?? 0;
  if ((precipNow ?? 0) > 0.1) {
    return { needed: "必要", reason: "現在すでに雨が降っています。" };
  }
  if (prob >= 50) {
    return {
      needed: "必要",
      reason: `日中の最大降水確率が ${prob}% と高めです。`,
    };
  }
  if (prob >= 30) {
    return {
      needed: "折りたたみ傘があると安心",
      reason: `日中の最大降水確率が ${prob}% です。念のため折りたたみを。`,
    };
  }
  if (isWetWeather(code)) {
    return {
      needed: "折りたたみ傘があると安心",
      reason: "天気が崩れる可能性があります。",
    };
  }
  return {
    needed: "不要",
    reason: `日中の最大降水確率は ${prob}% で低めです。`,
  };
}

/** 洗濯物（部屋干し+除湿でよいか）を判定 */
function judgeLaundry(
  probMax: number | null,
  precipNow: number | null,
  humidity: number | null,
  code: number | null,
): { advice: string; reason: string } {
  const prob = probMax ?? 0;
  const hum = humidity ?? 0;
  const raining = (precipNow ?? 0) > 0.1 || isWetWeather(code);

  if (raining || prob >= 50) {
    return {
      advice: "部屋干し + 除湿がおすすめ",
      reason: raining
        ? "雨（または雨の予報）のため外干しは避けたほうが無難です。"
        : `日中の降水確率が ${prob}% と高めなので、部屋干し + 除湿が安心です。`,
    };
  }
  if (hum >= 70 || prob >= 30) {
    return {
      advice: "部屋干し + 除湿が無難",
      reason: `湿度 ${hum}% / 降水確率 ${prob}% とやや乾きにくい条件です。外干しなら早めの取り込みを。`,
    };
  }
  return {
    advice: "外干しOK",
    reason: `湿度 ${hum}% / 降水確率 ${prob}% と乾きやすい条件です。`,
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
    umbrella: judgeUmbrella(
      precipitationProbabilityMax,
      precipitationNow,
      weatherCode,
    ),
    laundry: judgeLaundry(
      precipitationProbabilityMax,
      precipitationNow,
      humidity,
      weatherCode,
    ),
  };
}

/** 人間が読みやすい日本語テキストへ整形 */
export function formatWeather(r: WeatherResult): string {
  const fmtTemp = (v: number | null) => (v == null ? "—" : `${v}℃`);
  const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`);
  const fmtMm = (v: number | null) => (v == null ? "—" : `${v}mm`);

  return [
    `【${r.location} の今日の天気】`,
    ``,
    `天気: ${r.weather}`,
    `気温: 最高 ${fmtTemp(r.temperatureMax)} / 最低 ${fmtTemp(
      r.temperatureMin,
    )}（現在 ${fmtTemp(r.temperatureNow)}）`,
    `湿度: ${fmtPct(r.humidity)}（現在）`,
    `降水確率(日中最大): ${fmtPct(r.precipitationProbabilityMax)} / 予想降水量: ${fmtMm(
      r.precipitationSum,
    )}`,
    ``,
    `☂️ 傘: ${r.umbrella.needed}`,
    `   ${r.umbrella.reason}`,
    ``,
    `🧺 洗濯物: ${r.laundry.advice}`,
    `   ${r.laundry.reason}`,
  ].join("\n");
}
