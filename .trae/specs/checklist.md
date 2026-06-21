# MCP 图片抓取 — 补充 picjumbo.com 源 · 验证清单 (checklist.md)

- [ ] `src/picjumbo.js` 存在并导出 `searchImages / NetworkError / PicjumboScrapeError`。
- [ ] `picjumbo.searchImages({ keyword:"nature", count: 5 })` 返回 hits，每个 hit 含 `source === "picjumbo"`。
- [ ] 每个 hit 字段完整：`id / previewURL / webformatURL / largeImageURL / user / tags / source`；`largeImageURL` 为合法 HTTPS URL 且 host 属于 picjumbo。
- [ ] `picjumbo.searchImages({ keyword:"", count: 3 })` 返回 `[]`，不抛异常。
- [ ] 对较大 `count`（如 50），`picjumbo.searchImages` 返回 hits 数 ≥ 10，证明分页工作；能在到达边界后停止。
- [ ] `src/tools.js` schema 中 `source` 支持字符串或数组；默认值为 `["pixabay"]`；对 `source="unknown"` 或含 unknown 的数组均校验失败。
- [ ] `src/tools.js` handler 对多 source（如 `["pixabay","picjumbo"]`）分别调用对应源的 searchImages，合并 hits 并保留各 hit 的 `source` 字段。
- [ ] `src/tools.js` handler 返回的 payload `summary` 含各 source 的下载数量。
- [ ] `src/pixabay.js` 返回的 hit 也含 `source:"pixabay"`。
- [ ] `src/downloader.js` 的 `concurrentDownloadBatch` 输出的 `downloaded / failed` 项均含 `source` 字段。
- [ ] `src/server.js` 的 MCP tool schema 与 `tools.js` 一致（多值 source）；不传 source 时默认走 `["pixabay"]`。
- [ ] `tests/picjumbo.test.js` 存在，包含：picjumbo 单源单元测试、picjumbo 单源 E2E 测试、多源合并 E2E 测试。
- [ ] `npm test` 全量运行退出码 0；`tests/e2e.test.js` 与 `tests/tools.test.js` 保持通过。
- [ ] 测试运行后 `tmp/picjumbo-e2e/` 下至少有 1 个图片文件 size > 10KB，且来源为 picjumbo。
- [ ] 测试运行后 `tmp/multi-e2e/` 的 payload 中 downloaded 同时出现 `source:"pixabay"` 与 `source:"picjumbo"`。
- [ ] 任一 source 失败时 handler 返回 `isError: true` 且错误文本含对应 source 名或 `"Network"`；不完全崩溃。
- [ ] 未新增 npm 依赖（仅使用 Node 内置 `fetch` 与正则解析）。
