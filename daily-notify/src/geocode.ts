// 都市名 → 座標の解決。Open-Meteo の無料ジオコーディング API を使う（キー不要）。

import { fetchWithTimeout } from "./lib.js";

export interface Location {
  name: string;
  latitude: number;
  longitude: number;
}

/** 既定の対象地点: 東京都武蔵野市 */
export const DEFAULT_LOCATION: Location = {
  name: "東京都武蔵野市",
  latitude: 35.7178,
  longitude: 139.5664,
};

// Open-Meteo のジオコーディングは日本語の略称に弱く（「東京」「京都」「札幌」は0件、
// 「福岡」「横浜」は同名の小集落を誤ヒット）不安定なため、頻出の主要都市は
// エイリアス表で座標を直接解決する。ここに無いものはジオコーディングにフォールバック。
const JAPAN_CITY_ALIASES: Record<string, Location> = {
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
export async function geocode(city: string): Promise<Location | null> {
  // 1) エイリアス表を優先（頻出の主要都市を確実に解決）
  const alias = JAPAN_CITY_ALIASES[city];
  if (alias) return alias;

  // 2) Open-Meteo ジオコーディング。候補を多めに取り、日本国内・人口最大を選ぶ
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", city);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "ja");
  url.searchParams.set("format", "json");

  const res = await fetchWithTimeout(url.toString());
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
