// ローカルでダッシュボード画像を PNG ファイルへ書き出して見た目を確認する。
// 使い方: npm run preview [出力先パス]  (省略時は ./preview.png)

import { writeFile } from "node:fs/promises";
import { getTodayWeather } from "./weather.js";
import { buildDashboardHtml } from "./dashboard.js";
import { renderPng } from "./render.js";

async function main(): Promise<void> {
  const out = process.argv[2] ?? "preview.png";
  const result = await getTodayWeather();
  const png = await renderPng(buildDashboardHtml(result));
  await writeFile(out, png);
  console.log(
    `プレビューを書き出しました: ${out}（${result.location} / ${result.weather} / 洗濯 ${result.laundry.level}）`,
  );
}

main().catch((err) => {
  console.error("プレビュー生成でエラーが発生しました:", err);
  process.exit(1);
});
