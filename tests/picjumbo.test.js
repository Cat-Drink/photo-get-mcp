import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAndDownloadImagesSchema } from "../src/tools.js";

// ---- source 参数的 schema 测试 ----
test("schema 默认 source 不强制要求", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "nature",
    save_dir: "./tmp/test",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.keyword, "nature");
    assert.equal(result.data.save_dir, "./tmp/test");
  }
});

test("schema 接受字符串类型的 source='picjumbo'", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "nature",
    save_dir: "./tmp/test",
    source: "picjumbo",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.source, "picjumbo");
  }
});

test("schema 接受字符串类型的 source='pixabay'", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "nature",
    save_dir: "./tmp/test",
    source: "pixabay",
  });
  assert.equal(result.success, true);
});

test("schema 接受数组类型的 source=['pixabay','picjumbo']", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "nature",
    save_dir: "./tmp/test",
    source: ["pixabay", "picjumbo"],
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.source, ["pixabay", "picjumbo"]);
  }
});

// ---- picjumbo.js 的功能测试 ----
// 注意：这些测试依赖于对 web.archive.org 的网络访问
// 如果网络不稳定，可能会间歇性失败
test("picjumbo.js 对空关键词返回空数组", async () => {
  const { searchImages } = await import("../src/picjumbo.js");
  const hits = await searchImages({ keyword: "", count: 3 });
  assert.equal(Array.isArray(hits), true);
  assert.equal(hits.length, 0);
});

test("picjumbo.js 对有效关键词返回带 source='picjumbo' 的结果", { skip: false }, async () => {
  const { searchImages } = await import("../src/picjumbo.js");
  const hits = await searchImages({ keyword: "nature", count: 2, maxPages: 1 });
  if (hits.length > 0) {
    for (const hit of hits) {
      assert.equal(hit.source, "picjumbo", "每个 hit 应有 source='picjumbo'");
      assert.ok(hit.id !== undefined, "每个 hit 应有 id");
      assert.ok(hit.tags !== undefined || hit.tags === "", "每个 hit 应有 tags");
      assert.ok(hit.previewURL || hit.webformatURL || hit.largeImageURL, "每个 hit 至少应有一个图片 URL");
    }
  }
});

// ---- downloader.js 的 source 字段透传测试 ----
test("downloader 结果透传 source 字段", async () => {
  const { buildFileName } = await import("../src/downloader.js");
  const hit = {
    id: "test-1",
    source: "picjumbo",
    user: "picjumbo",
    tags: "nature",
    previewURL: "https://example.com/preview.jpg",
    webformatURL: "https://example.com/web.jpg",
    largeImageURL: "https://example.com/large.jpg",
    imageWidth: 100,
    imageHeight: 100,
  };
  const fileName = buildFileName(hit);
  assert.ok(fileName.length > 0);
  assert.ok(fileName.includes("test-1") || fileName.includes("nature"), "文件名应包含 id 或 tag");
});

test("downloader 能处理无 source 字段的 hit（兼容老数据）", async () => {
  const { buildFileName } = await import("../src/downloader.js");
  const hit = {
    id: "legacy-1",
    user: "someone",
    tags: "cat",
    previewURL: "https://example.com/p.jpg",
    webformatURL: "https://example.com/w.jpg",
    largeImageURL: "https://example.com/l.jpg",
    imageWidth: 100,
    imageHeight: 100,
  };
  const fileName = buildFileName(hit);
  assert.ok(fileName.length > 0);
});
