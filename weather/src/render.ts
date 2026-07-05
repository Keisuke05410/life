// ダッシュボード HTML を Playwright(chromium) で PNG 化する。
// #card 要素だけを 2x で撮影して鮮明な PNG Buffer を返す。

import { chromium } from "playwright";

export async function renderPng(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle" });
    const card = page.locator("#card");
    const buf = await card.screenshot({ type: "png" });
    return buf;
  } finally {
    await browser.close();
  }
}
