import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAndDownloadImagesSchema } from "../src/tools.js";

test("schema 对 keyword='' 校验失败", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "",
    save_dir: "./tmp/test",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some((issue) => issue.path[0] === "keyword"),
      "应存在 keyword 字段的校验错误"
    );
  }
});

test("schema 对 count=500 校验失败", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "cat",
    save_dir: "./tmp/test",
    count: 500,
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some((issue) => issue.path[0] === "count"),
      "应存在 count 字段的校验错误"
    );
  }
});

test("schema 对 size='huge' 校验失败", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "cat",
    save_dir: "./tmp/test",
    size: "huge",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some((issue) => issue.path[0] === "size"),
      "应存在 size 字段的校验错误"
    );
  }
});

test("schema 对合法输入通过，默认值正确", () => {
  const result = searchAndDownloadImagesSchema.safeParse({
    keyword: "nature",
    save_dir: "./tmp/test",
  });
  assert.equal(result.success, true);
  if (result.success) {
    const data = result.data;
    assert.equal(data.keyword, "nature");
    assert.equal(data.save_dir, "./tmp/test");
    assert.equal(data.count, 10);
    assert.equal(data.size, "webformat");
    assert.equal(data.safesearch, true);
  }
});
