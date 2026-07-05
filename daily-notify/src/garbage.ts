// 武蔵野市（ユーザーの収集地区）のゴミ収集日を、収集ルールから決定的に算出する。
// jma.ts と同様の独立モジュールだが、こちらは外部 fetch 不要（純粋関数のみ）。

import { jstDate, WEEKDAY_JA } from "./lib.js";
//
// 収集ルール（2026年7月以降・ユーザー地区）:
//   月: 古紙・古着（毎週） / ペットボトル（毎週・2026年7月から） / びん・缶・危険有害（隔週）
//   火: 燃やすごみ（毎週）
//   水: 燃やさないごみ（隔週）
//   木: プラスチック製容器包装（毎週）
//   金: 燃やすごみ（毎週）
//   土・日: なし
//
// 隔週の基準日（この日が収集日。以降14日周期）:
//   びん・缶・危険有害 = 2026-03-09（月） / 燃やさないごみ = 2026-03-11（水）
// ※ カレンダーは地区・時期依存。ルール変更時はこの表と基準日を更新すること。

export interface GarbageCategory {
  /** 内部キー（アイコン/色の対応に使う） */
  key: string;
  /** 表示ラベル */
  label: string;
}

export interface DayGarbage {
  /** YYYY-MM-DD（JST） */
  date: string;
  /** 曜日ラベル（日〜土） */
  weekdayLabel: string;
  /** その日の収集カテゴリ（無ければ空配列＝収集なし） */
  categories: GarbageCategory[];
}

export interface GarbageInfo {
  today: DayGarbage;
  tomorrow: DayGarbage;
}

// カテゴリ定義（キーと日本語ラベルを一元管理）
const CAT = {
  burnable: { key: "burnable", label: "燃やすごみ" },
  unburnable: { key: "unburnable", label: "燃やさないごみ" },
  plastic: { key: "plastic", label: "プラスチック製容器包装" },
  pet: { key: "pet", label: "ペットボトル" },
  paper: { key: "paper", label: "古紙・古着" },
  bottleCan: { key: "bottle-can", label: "びん・缶・危険有害" },
} as const;

/** 曜日(0=日..6=土) → 毎週収集するカテゴリ */
const WEEKLY_BY_DOW: Record<number, GarbageCategory[]> = {
  1: [CAT.paper, CAT.pet], // 月: 古紙・古着 + ペットボトル（2026年7月から毎週）
  2: [CAT.burnable], // 火: 燃やすごみ
  4: [CAT.plastic], // 木: プラスチック製容器包装
  5: [CAT.burnable], // 金: 燃やすごみ
};

/** 隔週収集ルール（基準日と対象カテゴリ。基準日から14日周期で収集） */
const BIWEEKLY: Array<{ anchor: string; category: GarbageCategory }> = [
  { anchor: "2026-03-09", category: CAT.bottleCan }, // 月・びん缶危険有害
  { anchor: "2026-03-11", category: CAT.unburnable }, // 水・燃やさないごみ
];

/** 年末年始の収集休止（概ね 1/1〜1/3）。※正確な休止日は要確認 */
function isCollectionHoliday(month: number, day: number): boolean {
  return month === 1 && day >= 1 && day <= 3;
}

/** "YYYY-MM-DD" を JST 深夜相当の通し日数（UTC ベース整数）へ */
function toDayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** ある日付(YYYY-MM-DD, 曜日)の収集カテゴリを算出 */
function categoriesForDate(ymd: string, dow: number): GarbageCategory[] {
  const [, m, d] = ymd.split("-").map(Number);
  if (isCollectionHoliday(m, d)) return [];

  const cats: GarbageCategory[] = [...(WEEKLY_BY_DOW[dow] ?? [])];

  const dayNum = toDayNumber(ymd);
  for (const rule of BIWEEKLY) {
    const diff = dayNum - toDayNumber(rule.anchor);
    // 基準日と同じ曜日・14日周期でのみ収集（diff は非負・負どちらでも 14 の倍数で判定）
    if (diff % 14 === 0) cats.push(rule.category);
  }
  return cats;
}

function buildDay(base: Date, offsetDays: number): DayGarbage {
  const { ymd, dow } = jstDate(base, offsetDays);
  return {
    date: ymd,
    weekdayLabel: WEEKDAY_JA[dow] ?? "",
    categories: categoriesForDate(ymd, dow),
  };
}

/** 今日・明日（JST）のゴミ収集情報を返す */
export function getGarbage(): GarbageInfo {
  const now = new Date();
  return {
    today: buildDay(now, 0),
    tomorrow: buildDay(now, 1),
  };
}
