// 複数モジュールから使う小さな共通ユーティリティ。
// 数値ヘルパー / JST 日付 / 時間帯定義 / 天気ラベル分類 / fetch ヘルパー。

// ---- 数値 ----

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export const avg = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

export const round1 = (v: number | null): number | null =>
  v == null ? null : Math.round(v * 10) / 10;

/** 気温の共通表記（null は em ダッシュ） */
export const fmtTemp = (v: number | null): string =>
  v == null ? "—" : `${Math.round(v)}°`;

// ---- JST 日付 ----

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** offset 日後の JST 日付を { ymd: "YYYY-MM-DD", dow: 0(日)-6(土) } で返す */
export function jstDate(
  base: Date,
  offsetDays = 0,
): { ymd: string; dow: number } {
  const shifted = new Date(base.getTime() + offsetDays * 86400000);
  // JST の Y-M-D（en-CA は YYYY-MM-DD 形式）
  const ymd = shifted.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  // JST の曜日
  const wd = shifted.toLocaleDateString("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  });
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { ymd, dow };
}

// ---- 時間帯（朝/昼/夜）の定義 ----

export type PeriodKey = "morning" | "afternoon" | "evening";

export interface PeriodDef {
  key: PeriodKey;
  /** 表示ラベル（朝 / 昼 / 夜） */
  label: string;
  /** 開始時（両端含む） */
  from: number;
  /** 終了時（両端含む） */
  to: number;
}

/** 朝(6-11) / 昼(12-17) / 夜(18-23)。集計とダッシュボード表示の両方がこれを参照する。 */
export const PERIOD_DEFS: readonly PeriodDef[] = [
  { key: "morning", label: "朝", from: 6, to: 11 },
  { key: "afternoon", label: "昼", from: 12, to: 17 },
  { key: "evening", label: "夜", from: 18, to: 23 },
] as const;

// ---- 天気ラベルの分類 ----

export type WeatherKind =
  | "thunder"
  | "snow"
  | "rain"
  | "fog"
  | "cloud"
  | "clear"
  | "unknown";

/**
 * 日本語の天気ラベルを大分類する。アイコン・絵文字の選択が同じ優先順位
 * （雷 > 雪 > 雨 > 霧 > 曇 > 晴）で判定するための共通関数。
 */
export function weatherKind(label: string | null): WeatherKind {
  if (!label) return "unknown";
  if (label.includes("雷")) return "thunder";
  if (label.includes("雪")) return "snow";
  if (label.includes("雨")) return "rain";
  if (label.includes("霧")) return "fog";
  if (label.includes("曇")) return "cloud";
  if (label.includes("晴")) return "clear"; // 「快晴」もここに含む
  return "unknown";
}

// ---- fetch ヘルパー ----

const FETCH_TIMEOUT_MS = 15_000;

/** タイムアウト付き fetch（既定 15 秒）。外部 API 呼び出しは必ずこれを使う。 */
export function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...init });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * doFetch を最大 attempts 回試行する。ネットワークエラーと 5xx/429 のみ
 * リトライし（バックオフ 1s, 2s, …）、4xx はそのまま返して呼び出し側に委ねる。
 */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1000 * 2 ** (i - 1));
    try {
      const res = await doFetch();
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
