import { z } from "zod";
import { searchImages as searchPixabay, getApiKey, PixabayApiError, NetworkError } from "./pixabay.js";
import { searchImages as searchPicjumbo } from "./picjumbo.js";
import { ensureDir, concurrentDownloadBatch } from "./downloader.js";
import path from "node:path";

const VALID_SOURCES = Object.freeze(["pixabay", "picjumbo"]);

function normalizeSources(input) {
  if (input === undefined || input === null) {
    return ["pixabay"];
  }
  if (Array.isArray(input)) {
    const filtered = input
      .map((s) => String(s).toLowerCase().trim())
      .filter((s) => VALID_SOURCES.includes(s));
    return filtered.length > 0 ? [...new Set(filtered)] : ["pixabay"];
  }
  const s = String(input).toLowerCase().trim();
  if (VALID_SOURCES.includes(s)) return [s];
  // Support comma-separated string like "pixabay,picjumbo"
  if (s.includes(",")) {
    const parts = s.split(",")
      .map((p) => p.trim().toLowerCase())
      .filter((p) => VALID_SOURCES.includes(p));
    return parts.length > 0 ? [...new Set(parts)] : ["pixabay"];
  }
  return ["pixabay"];
}

// Zod raw shape：MCP registerTool 需要 raw shape，测试需要完整 z.object，
// 因此拆成两份导出，单一来源。
export const searchAndDownloadImagesShape = {
  keyword: z.string().min(1, "keyword不能为空").max(100, "keyword过长"),
  save_dir: z.string().min(1, "save_dir不能为空"),
  count: z.number().int().min(1, "count必须≥1").max(200, "count必须≤200").default(10),
  size: z.enum(["preview", "webformat", "large"]).default("webformat"),
  safesearch: z.boolean().default(true),
  source: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("图片来源，可选 'pixabay' 或 'picjumbo'，或数组（如 ['pixabay','picjumbo']）。默认 'pixabay'。"),
};

export const searchAndDownloadImagesSchema = z.object(searchAndDownloadImagesShape);

export const searchAndDownloadImagesInputSchema = {
  type: "object",
  properties: {
    keyword: { type: "string", description: "搜索关键词，例如 nature、cat、landscape", minLength: 1, maxLength: 100 },
    save_dir: { type: "string", description: "图片保存目录（绝对路径或相对路径），若不存在会自动创建" },
    count: { type: "number", description: "下载图片数量，默认 10，范围 1-200", minimum: 1, maximum: 200, default: 10 },
    size: { type: "string", description: "图片尺寸，默认 webformat（640px）", enum: ["preview", "webformat", "large"] },
    safesearch: { type: "boolean", description: "是否启用安全搜索（过滤成人内容），默认 true", default: true },
    source: {
      type: "array",
      description: "图片来源列表，支持 'pixabay' 和 'picjumbo'。默认 ['pixabay']",
      items: { type: "string", enum: ["pixabay", "picjumbo"] },
      default: ["pixabay"],
    },
  },
  required: ["keyword", "save_dir"],
};

async function searchFromSource(sourceName, { keyword, count, safesearch }) {
  const perSourceCount = Math.max(1, Math.ceil(count));
  if (sourceName === "pixabay") {
    try {
      return await searchPixabay({ keyword, count: perSourceCount, safesearch });
    } catch (err) {
      // Re-throw with metadata but don't fail the entire multi-source search;
      // handled at higher level
      throw err;
    }
  }
  if (sourceName === "picjumbo") {
    const hits = await searchPicjumbo({ keyword, count: perSourceCount });
    return hits;
  }
  return [];
}

async function searchImagesFromSources(sources, { keyword, count, safesearch }) {
  // Distribute count across sources so the total roughly equals count.
  const perSourceCount = Math.max(1, Math.ceil(count / sources.length));
  const results = [];
  const errors = [];
  for (const src of sources) {
    try {
      const hits = await searchFromSource(src, { keyword, count: perSourceCount, safesearch });
      results.push(...hits);
    } catch (err) {
      errors.push({ source: src, message: err && err.message ? err.message : String(err) });
    }
  }
  // Sort to interleave by source for nicer distribution, then trim to count.
  // Simple ordering: keep stable per-source, let the user see both.
  // Deduplicate by (source, id) to be safe.
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

export async function searchAndDownloadImagesHandler(args) {
  const parsed = searchAndDownloadImagesSchema.safeParse(args);
  if (!parsed.success) {
    const { error } = parsed;
    return {
      content: [{ type: "text", text: "参数校验失败: " + JSON.stringify(error.issues) }],
      isError: true,
    };
  }

  const { keyword, save_dir, count, size, safesearch } = parsed.data;
  const sources = normalizeSources(parsed.data.source);

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
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }

  if (hits.length === 0) {
    const msg = searchErrors.length
      ? `搜索失败或无结果。来源错误: ${JSON.stringify(searchErrors)}`
      : `没有找到任何图片。关键词: ${keyword}，来源: ${sources.join(", ")}`;
    return {
      content: [{ type: "text", text: msg }],
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
    const result = await concurrentDownloadBatch(hits, save_dir, { size, concurrency: 5 });
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
    sources,
    source_counts: sources.reduce((acc, s) => {
      acc[s] = hits.filter((h) => (h.source || "pixabay") === s).length;
      return acc;
    }, {}),
    downloaded,
    failed,
    search_warnings: searchErrors,
    save_dir: path.resolve(save_dir),
    summary: `已下载 ${downloaded.length} 张图片至 ${save_dir}，${failed.length} 张失败。关键词: ${keyword}，来源: ${sources.join(", ")}`,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: false,
  };
}

export const tools = [
  {
    name: "search_and_download_images",
    description: "按关键词从 Pixabay 和/或 Picjumbo 搜索图片并保存到本地目录。返回图片元数据与本地保存路径。",
    inputSchema: searchAndDownloadImagesInputSchema,
  },
];

export const handlers = {
  search_and_download_images: searchAndDownloadImagesHandler,
};

// server.js 遍历此列表完成注册：schema 与 handler 只在 tools.js 定义一份。
export const toolRegistrations = [
  {
    name: "search_and_download_images",
    description: "按关键词从 Pixabay 和/或 Picjumbo 搜索图片并保存到本地目录。返回图片元数据与本地保存路径。",
    inputSchema: searchAndDownloadImagesShape,
    handler: searchAndDownloadImagesHandler,
  },
];
