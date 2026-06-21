import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchImages, PixabayApiError, NetworkError } from "./pixabay.js";
import { ensureDir, concurrentDownloadBatch } from "./downloader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mcpServer = new McpServer({
  name: "photo-get-skill",
  version: "1.0.0",
});

mcpServer.registerTool(
  "search_and_download_images",
  {
    description:
      "按关键词从 Pixabay 搜索图片并保存到本地目录。返回图片元数据与本地保存路径。",
    inputSchema: {
      keyword: z
        .string()
        .min(1)
        .max(100)
        .describe("搜索关键词，例如 nature、cat、landscape"),
      save_dir: z
        .string()
        .min(1)
        .describe("图片保存目录（绝对路径或相对路径），若不存在会自动创建"),
      count: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(10)
        .describe("下载图片数量，默认 10，范围 1-200"),
      size: z
        .enum(["preview", "webformat", "large"])
        .default("webformat")
        .describe("图片尺寸，默认 webformat（640px）"),
      safesearch: z
        .boolean()
        .default(true)
        .describe("是否启用安全搜索（过滤成人内容），默认 true"),
    },
  },
  async (args) => {
    const { keyword, save_dir, count, size, safesearch } = args;

    let hits;
    try {
      hits = await searchImages({ keyword, count, safesearch });
    } catch (err) {
      let message;
      if (err instanceof PixabayApiError) {
        message = `Pixabay API 错误 (${err.statusCode}): ${err.message}`;
      } else if (err instanceof NetworkError) {
        message = `网络错误: ${err.message}`;
      } else {
        message = `未知错误: ${err && err.message ? err.message : String(err)}`;
      }
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }

    try {
      ensureDir(save_dir);
    } catch (err) {
      return {
        content: [{ type: "text", text: `无法创建目录: ${err.message}` }],
        isError: true,
      };
    }

    let downloaded = [];
    let failed = [];
    try {
      const result = await concurrentDownloadBatch(hits, save_dir, {
        size,
        concurrency: 5,
      });
      downloaded = result.downloaded || [];
      failed = result.failed || [];
    } catch (err) {
      return {
        content: [{ type: "text", text: `下载过程中发生错误: ${err.message}` }],
        isError: true,
      };
    }

    const payload = {
      total: hits.length,
      downloaded,
      failed,
      save_dir: path.resolve(save_dir),
      summary: `已下载 ${downloaded.length} 张图片至 ${save_dir}，${failed.length} 张失败。关键词: ${keyword}`,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

process.on("uncaughtException", (error) => {
  console.error("[photo-get-skill] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[photo-get-skill] unhandledRejection:", reason);
});

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[photo-get-skill] MCP server ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
