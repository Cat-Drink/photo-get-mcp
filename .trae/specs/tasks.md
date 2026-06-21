# MCP 图片抓取 — 补充 picjumbo.com 源 · 实现计划 (tasks.md)

## [ ] Task 1: 新增 `src/picjumbo.js` — picjumbo.com 轻量抓取客户端（健壮分页）
- **Priority**: P0
- **Depends On**: None
- **Description**:
  - 导出 `async searchImages({ keyword, count })`：
    - `keyword` 为空或仅含空白时直接返回 `[]`。
    - 分页：从 `page=1` 开始，URL 为 `https://picjumbo.com/search/{encodedKeyword}/page/{page}/`；同时第 1 页也可以不指定 page，直接 `https://picjumbo.com/search/{encodedKeyword}/`。
    - 分页边界探测：
      - 若 GET 返回 `status === 404` 或响应体为空字符串 → 停止；
      - 解析当前页中的详情页 URL 列表，若与前一页完全相同或为空 → 停止；
      - 解析当前页底部出现的分页链接（页码或 `下一页 / next` 等），作为继续翻页的依据；
      - 设置最大页数上限（如 100 页），避免死循环；
      - 一旦 hits 长度达到 `count` 立即停止。
    - 每页解析：
      - 提取 `<a href="https://picjumbo.com/{slug}/">` 中的详情页 URL，去重（以 URL 为 key）；
      - 并发（≤ 5）获取每个详情页 HTML，解析：
        - `<meta property="og:image" content="...">` → `largeImageURL`；
        - 页面中出现的缩略图（含 `picjumbo.com/wp-content/...`），取较小尺寸作 `previewURL`、稍大尺寸作 `webformatURL`；
        - 从 `<title>` 中提取标题，切词作为 tags 的一部分；原始 keyword 也加入 tags；
        - 从正文中解析作者文本（`by ...`）或作者链接（如 `author/viktorhanacek`），失败时默认 `user="picjumbo"`；
        - `id`：从正文中 `download?image=<id>` 提取；若不存在则使用 slug 的稳定字符串（例如 slug 本身或其 hash）。
    - 对解析出的 URL 做 host 白名单校验：`picjumbo.com`, `i.picjumbo.com`, `picjumbo` 子域名；不在白名单的 URL 丢弃。
    - 返回 hits，字段：`{ id, source:"picjumbo", previewURL, webformatURL, largeImageURL, user, tags, imageWidth, imageHeight, page_url }`；尺寸字段未解析到时写 `0`。
  - 导出错误类型：`NetworkError`（网络层面）、`PicjumboScrapeError`（解析/业务层面）。
  - 网络策略：超时 30s，失败重试至多 2 次。
  - 可选 CLI smoke：当脚本以主模块运行时，执行 `searchImages({ keyword: "nature", count: 5 })` 并打印 hits 总数与首个 hit 的 largeImageURL。
- **Acceptance Criteria Addressed**: FR-1, G3, G4, NFR-1, NFR-2, NFR-3
- **Test Requirements**:
  - `programmatic` TR-1.1: `await picjumbo.searchImages({ keyword: "nature", count: 5 })` 返回 hits 长度 ≥ 1，每个 hit 含 `source === "picjumbo"`。
  - `programmatic` TR-1.2: 每个 hit 字段完整（`id / previewURL / webformatURL / largeImageURL / user / tags`）；`largeImageURL` 以 `https://` 开头且 host 属于 picjumbo。
  - `programmatic` TR-1.3: `searchImages({ keyword: "", count: 3 })` 返回 `[]`，不抛异常。
  - `programmatic` TR-1.4: 对返回条数较多的关键词（例如 `nature`），当 `count` 未设上限时（或传较大 `count` 如 50），返回 hits 数超过单页数量，证明分页工作。

## [ ] Task 2: 扩展 `src/tools.js` — `source` 支持多值，结果区分来源
- **Priority**: P0
- **Depends On**: Task 1
- **Description**:
  - `searchAndDownloadImagesSchema` 中：
    - 原 `source` 改为 `z.union([z.enum(["pixabay", "picjumbo"]), z.array(z.enum(["pixabay","picjumbo"])).min(1)]).default(["pixabay"])`。
    - 在 handler 内 normalize：`const sources = Array.isArray(parsed.data.source) ? parsed.data.source : [parsed.data.source];`。
  - `searchAndDownloadImagesInputSchema` 中：
    - `source: { oneOf: [{ type: "string", enum: ["pixabay","picjumbo"] }, { type: "array", items: { type: "string", enum: ["pixabay","picjumbo"] }, minItems: 1 }], default: ["pixabay"], description: "图片来源，可传单个字符串或数组，默认 pixabay" }`。
  - Handler 分派逻辑：
    - 若 `sources.length === 1`：直接调用对应源的 `searchImages({ keyword, count, safesearch })`。
    - 若 `sources.length > 1`：按源均匀分配 `count`（每源 `Math.ceil(count / sources.length)`），并发生成，合并 hits 时按 source 顺序拼接，最后再截取到 `count`；也可改为按传入顺序顺序执行后合并。
    - 单源失败（抛异常）时：将该源的错误记录到一个错误集合；若所有源都失败，则整体返回 `isError: true` 的错误；若部分源成功，照常下载成功 hits，`summary` 中提示失败的 source。
  - 每个 hit 必须已经带有 `source` 字段（pixabay.js 中需确保也写入 `source:"pixabay"`，若原先没有则补充）。
  - `summary`：按照 source 聚合出各源成功下载数量，例如 `已下载 3 张图片至 <dir>（pixabay 2 张，picjumbo 1 张），失败 0 张。关键词: nature`。
- **Acceptance Criteria Addressed**: FR-2, FR-3, G2, G3, G5, AC-1, AC-3, AC-5
- **Test Requirements**:
  - `programmatic` TR-2.1: schema 对 `source="unknown"` 校验失败；对 `source=["pixabay","unknown"]` 校验失败。
  - `programmatic` TR-2.2: schema 缺省值为 `["pixabay"]`；允许 `source="pixabay"` 也允许 `source=["pixabay","picjumbo"]`。
  - `programmatic` TR-2.3: 对 `source="picjumbo"` 走 picjumbo 分支；对多 source 返回 payload 中同时出现不同 source 的 downloaded 项。

## [ ] Task 3: 扩展 `src/downloader.js` — 让下载结果包含 `source` 字段
- **Priority**: P1
- **Depends On**: Task 2
- **Description**:
  - `concurrentDownloadBatch` 中对每个 hit 的 downloaded/failed 项新增透传 `source: hit.source`；若缺失则写 `source:"unknown"`，但日志中警告一次。
  - 对 Pixabay source 也确保 `source` 字段存在（由 pixabay.js 保证写入 `source:"pixabay"`）。
- **Acceptance Criteria Addressed**: FR-4
- **Test Requirements**:
  - `programmatic` TR-3.1: E2E 测试中 downloaded 项均含 `source` 字段。

## [ ] Task 4: 同步 `src/server.js` schema
- **Priority**: P1
- **Depends On**: Task 2
- **Description**:
  - 将 `src/server.js` 中 `search_and_download_images` 的 Zod schema 也加上多值 `source` 字段（与 `tools.js` 一致）。
  - 保持默认值 `["pixabay"]`，以便原 E2E 调用不传 source 仍走 Pixabay。
- **Acceptance Criteria Addressed**: FR-5, AC-1
- **Test Requirements**:
  - `programmatic` TR-4.1: 旧 E2E 调用（无 source）仍走 Pixabay 分支并返回与之前一致的 payload。

## [ ] Task 5: 确保 `src/pixabay.js` 输出 hit 也带 `source:"pixabay"`
- **Priority**: P1
- **Depends On**: Task 1
- **Description**:
  - 在 pixabay 的 hits 生成循环中，对每个 hit 补充 `source: "pixabay"`。最小改动，避免影响已有字段。
- **Acceptance Criteria Addressed**: FR-4, AC-1
- **Test Requirements**:
  - `programmatic` TR-5.1: `pixabay.searchImages(...)` 返回的第一个 hit 含 `source === "pixabay"`。

## [ ] Task 6: 新增 `tests/picjumbo.test.js`（单元 + 端到端 + 多源）
- **Priority**: P0
- **Depends On**: Task 1, 2, 3, 4, 5
- **Description**:
  - 单元：
    - `picjumbo.searchImages({ keyword:"nature", count: 3 })` → hits 长度 ≥ 1，每个 hit.source === "picjumbo"。
    - `picjumbo.searchImages({ keyword:"", count: 3 })` → 返回 `[]`。
    - 以较大 `count`（如 50）调用 `picjumbo.searchImages({ keyword:"nature", count: 50 })`，验证 hits 长度 ≥ 10（分页能累积）。
  - 端到端（`source="picjumbo"`）：
    - `spawn("node", [src/server.js])`，发送 MCP JSON-RPC：`initialize → notifications/initialized → tools/list → tools/call { keyword:"nature", save_dir:"tmp/picjumbo-e2e", count:3, size:"large", safesearch:true, source:"picjumbo" }`。
    - 断言 `downloaded.length >= 1`，每个 downloaded 项含 `source === "picjumbo"` 且 `local_path` 文件存在，size > 10KB。
  - 端到端（多源）：
    - `tools/call { keyword:"nature", save_dir:"tmp/multi-e2e", count:6, size:"webformat", safesearch:true, source:["pixabay","picjumbo"] }`。
    - 断言 downloaded 中至少同时出现 `source:"pixabay"` 与 `source:"picjumbo"` 两种项。
- **Acceptance Criteria Addressed**: FR-6, AC-2, AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-6.1: `node --test tests/picjumbo.test.js` 退出码 0。
  - `programmatic` TR-6.2: `tmp/picjumbo-e2e/` 下至少有 1 个文件 size > 10KB。
  - `programmatic` TR-6.3: `tmp/multi-e2e/` 下同时出现不同 source 的下载记录。

## [ ] Task 7: 回归验证 — 原有 `tests/tools.test.js` / `tests/e2e.test.js` 保持通过
- **Priority**: P0
- **Depends On**: Task 2, 3, 4, 5
- **Description**:
  - 运行 `npm test`（`node --test tests/`），确保旧测试全部通过。
  - 如 `tests/tools.test.js` 的 schema 断言因新增字段受影响，微调断言（不影响对 keyword/count/size 的核心校验）。
  - `tests/e2e.test.js` 不做业务输入修改（不传 source）。
- **Acceptance Criteria Addressed**: AC-1, AC-6
- **Test Requirements**:
  - `programmatic` TR-7.1: `npm test` 退出码 0。

## 依赖关系图 (DAG)
```
Task 1 (src/picjumbo.js)
 ├──> Task 5 (src/pixabay.js: 确保 hits 含 source="pixabay")
 └──> Task 2 (src/tools.js: source 多值 + 分派 + 合并)
          ├──> Task 3 (src/downloader.js: 透传 source)
          └──> Task 4 (src/server.js schema 同步)
                   └──> Task 6 (tests/picjumbo.test.js)
                            └──> Task 7 (回归验证)
```
