// Open-Meteo forecast API のレスポンス型と取得処理。API キー不要。

import type { Location } from "./geocode.js";
import { fetchWithRetry, fetchWithTimeout } from "./lib.js";

export interface ForecastResponse {
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

export async function fetchForecast(loc: Location): Promise<ForecastResponse> {
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

  // 通知の生命線なので、一時的な失敗（ネットワーク/5xx）はリトライする
  const res = await fetchWithRetry(() => fetchWithTimeout(url.toString()));
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast API エラー: ${res.status}`);
  }
  return (await res.json()) as ForecastResponse;
}
