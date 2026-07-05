// ダッシュボード HTML をブラウザで確認するためのローカル静的サーバー。
// 使い方: npm run serve  (http://localhost:8787 を開く。リロードで最新データを再取得)

import { createServer } from "node:http";
import { buildDashboardHtml } from "./dashboard.js";
import { getGarbage } from "./garbage.js";
import { getTodayWeather } from "./weather.js";

const PORT = Number(process.env.PORT ?? 8787);

const server = createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404).end("Not Found");
    return;
  }
  try {
    const result = await getTodayWeather();
    const garbage = getGarbage();
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(buildDashboardHtml(result, garbage));
  } catch (err) {
    console.error("ダッシュボード生成でエラーが発生しました:", err);
    res
      .writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
      .end(`エラー: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(PORT, () => {
  console.log(`プレビューサーバー起動: http://localhost:${PORT}`);
});
