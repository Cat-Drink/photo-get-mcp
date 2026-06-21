import { z } from "zod";
import { searchImages, getApiKey, PixabayApiError, NetworkError } from "./pixabay.js";
import { ensureDir, pickUrl, concurrentDownloadBatch } from "./downloader.js";
import path from "node:path";

export const searchAndDownloadImagesSchema = z.object({
  keyword: z.string().min(1, "keyword不能为空").max(100, "keyword过长"),
  save_dir: z.string().min(1, "save_dir不能为空"),
  count: z.number().int().min(1, "count必须≥1").max(200, "count必须≤200").default(10),
  size: z.enum(["preview", "webformat", "large"]).default("webformat"),
  safesearch: z.boolean().default(true),
});

export const searchAndDownloadImagesInputSchema = {
  type: "object",
  properties: {
    keyword: { type: "string", description: "搜索关键词，例如 nature、cat、landscape", minLength: 1, maxLength: 100 },
    save_dir: { type: "string", description: "图片保存目录（绝对路径或相对路径），若不存在会自动创建" },
    count: { type: "number", description: "下载图片数量，默认 10，范围 1-200", minimum: 1, maximum: 200, default: 10 },
    size: { type: "string", description: "图片尺寸，默认 webformat（640px）", enum: ["preview", "webformat", "large"] },
    safesearch: { type: "boolean", description: "是否启用安全搜索（过滤成人内容），默认 true", default: true },
  },
  required: ["keyword", "save_dir"],
};

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
    downloaded,
    failed,
    save_dir: path.resolve(save_dir),
    summary: `已下载 ${downloaded.length} 张图片至 ${save_dir}，${failed.length} 张失败。关键词: ${keyword}`,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: false,
  };
}

export const tools = [
  {
    name: "search_and_download_images",
    description: "按关键词从 Pixabay 搜索图片并保存到本地目录。返回图片元数据与本地保存路径。",
    inputSchema: searchAndDownloadImagesInputSchema,
  },
];

export const handlers = {
  search_and_download_images: searchAndDownloadImagesHandler,
};
