import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchImages as searchPixabay, PixabayApiError, NetworkError } from "./pixabay.js";
import { searchImages as searchPicjumbo } from "./picjumbo.js";
import { ensureDir, concurrentDownloadBatch } from "./downloader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_SOURCES = Object.freeze(["pixabay", "picjumbo"]);

function normalizeSources(input) {
  if (input === undefined || input === null) return ["pixabay"];
  if (Array.isArray(input)) {
    const filtered = input
      .map((s) => String(s).toLowerCase().trim())
      .filter((s) => VALID_SOURCES.includes(s));
    return filtered.length > 0 ? [...new Set(filtered)] : ["pixabay"];
  }
  const s = String(input).toLowerCase().trim();
  if (VALID_SOURCES.includes(s)) return [s];
  if (s.includes(",")) {
    const parts = s.split(",")
      .map((p) => p.trim().toLowerCase())
      .filter((p) => VALID_SOURCES.includes(p));
    return parts.length > 0 ? [...new Set(parts)] : ["pixabay"];
  }
  return ["pixabay"];
}

async function searchImagesFromSources(sources, { keyword, count, safesearch }) {
  const perSourceCount = Math.max(1, Math.ceil(count / sources.length));
  const results = [];
  const errors = [];
  for (const src of sources) {
    try {
      if (src === "pixabay") {
        const hits = await searchPixabay({ keyword, count: perSourceCount, safesearch });
        results.push(...hits);
      } else if (src === "picjumbo") {
        const hits = await searchPicjumbo({ keyword, count: perSourceCount });
        results.push(...hits);
      }
    } catch (err) {
      errors.push({ source: src, message: err && err.message ? err.message : String(err) });
    }
  }
  const seen = new Set();
  const unique = [];
  for (const hit of results) {
    const key = `${hit.source || "unknown"}-${hit.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return { hits: unique.slice(0, count), errors };
}

const mcpServer = new McpServer({
  name: "photo-get-skill",
  version: "1.0.0",
});

mcpServer.registerTool(
  "search_and_download_images",
  {
    description:
      "按关键词从 Pixabay 和/或 Picjumbo 搜索图片并保存到本地目录。返回图片元数据与本地保存路径。",
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
      source: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .default(["pixabay"])
        .describe("图片来源，支持 'pixabay' 和 'picjumbo'。可以是字符串或数组。默认 ['pixabay']"),
    },
  },
  async (args) => {
    const keyword = String(args.keyword || "").trim();
    const save_dir = String(args.save_dir || "").trim();
    const count = typeof args.count === "number" ? Math.min(200, Math.max(1, Math.floor(args.count))) : 10;
    const size = ["preview", "webformat", "large"].includes(String(args.size)) ? String(args.size) : "webformat";
    const safesearch = typeof args.safesearch === "boolean" ? args.safesearch : true;
    const sources = normalizeSources(args.source);

    if (!keyword) {
      return { content: [{ type: "text", text: "关键词不能为空" }], isError: true };
    }
    if (!save_dir) {
      return { content: [{ type: "text", text: "保存目录不能为空" }], isError: true };
    }

    let hits = [];
    let searchErrors = [];
    try {
      const result = await searchImagesFromSources(sources, { keyword, count, safesearch });
      hits = result.hits;
      searchErrors = result.errors || [];
    } catch (err) {
      let message;
      if (err instanceof PixabayApiError) {
        message = `Pixabay API 错误 (${err.statusCode}): ${err.message}`;
      } else if (err instanceof NetworkError) {
        message = `网络错误: ${err.message}`;
      } else {
        message = `未知错误: ${err && err.message ? err.message : String(err)}`;
      }
      return { content: [{ type: "text", text: message }], isError: true };
    }

    if (hits.length === 0) {
      const msg = searchErrors.length
        ? `搜索失败或无结果。来源错误: ${JSON.stringify(searchErrors)}`
        : `没有找到任何图片。关键词: ${keyword}，来源: ${sources.join(", ")}`;
      return { content: [{ type: "text", text: msg }], isError: true };
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
      const result = await concurrentDownloadBatch(hits, save_dir, { size, concurrency: 5 });
      downloaded = result.downloaded || [];
      failed = result.failed || [];
    } catch (err) {
      return {
        content: [{ type: "text", text: `下载过程中发生错误: ${err.message}` }],
        isError: true,
      };
    }

    const sourceCounts = sources.reduce((acc, s) => {
      acc[s] = hits.filter((h) => (h.source || "pixabay") === s).length;
      return acc;
    }, {});

    const payload = {
      total: hits.length,
      sources,
      source_counts: sourceCounts,
      downloaded,
      failed,
      search_warnings: searchErrors,
      save_dir: path.resolve(save_dir),
      summary: `已下载 ${downloaded.length} 张图片至 ${save_dir}，${failed.length} 张失败。关键词: ${keyword}，来源: ${sources.join(", ")}`,
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
