import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTodayWeather, formatWeather } from "./weather.js";

export class WeatherMCP extends McpAgent {
  server = new McpServer({
    name: "weather-mcp",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "get_today_weather",
      "指定した都市（省略時は東京都武蔵野市）の今日の天気・気温・湿度に加えて、傘が必要か、洗濯物は部屋干し+除湿でよいかの判定を返します。",
      {
        city: z
          .string()
          .optional()
          .describe(
            "天気を調べたい都市名（例: 東京, 大阪, 武蔵野市）。省略すると東京都武蔵野市。",
          ),
      },
      async ({ city }) => {
        try {
          const result = await getTodayWeather(city);
          return {
            content: [{ type: "text", text: formatWeather(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `天気の取得に失敗しました: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
}

export default WeatherMCP.serve("/mcp");
