# MCP 图片抓取 — 补充 picjumbo.com 源（多 source 支持 + 来源区分 + 翻页全量）- PRD

## Overview
- **Summary**: 在现有 `photo-get-skill` MCP 服务器基础上，**新增对 `https://picjumbo.com/` 的图片搜索与下载支持**，同时**支持多 source 并发生成结果**（`source` 接受多个值）。原有 Pixabay 源保持完全可用，并作为默认值包含在默认 source 列表中；每张图片在命中结果与最终下载结果里都**明确标注来源**（`source: "pixabay" | "picjumbo"`）。`picjumbo.com` 的分页能**自动翻到所有页并完整采集**。
- **Purpose**: 拓展图片素材来源并可同时在多个源检索图片；在返回 payload 中区分来源，便于 LLM 下游进行过滤/去重/署名。
- **Target Users**:
  - LLM 应用开发者（MCP + 多源图片工具）
  - 内容创作者 / 设计师（批量获取多样化素材）
  - 需要来源追踪或多源聚合的工作流

## Goals
- **[G1] 新增 `picjumbo.com` 源**：与 Pixabay 并列的检索+下载能力。
- **[G2] `source` 支持多值**：用户可传 `"pixabay"`、`"picjumbo"`，也可传 `["pixabay", "picjumbo"]` 同时检索。
- **[G3] 结果区分来源**：每个 `hit`、`downloaded` item、`failed` item 均含 `source` 字段。
- **[G4] picjumbo 全量翻页**：能自动探测分页边界（通过搜索页底部分页链接或 `page={n} 404` 判断），按 `count` 截取，若 `count` 未设上限则采集所有页。
- **[G5] 兼容旧行为**：不传 `source` 时默认走 `["pixabay"]`；旧 E2E 测试使用默认值能得到与之前一致的 Pixabay 结果。
- **[G6] 测试覆盖**：同时验证多源场景与单 picjumbo 场景的检索+下载。

## Non-Goals (Out of Scope)
- **不**使用无头浏览器/Playwright。
- **不**改动 Pixabay 错误处理与 API Key 机制。
- **不**新增其他源（本 PRD 仅 Pixabay + picjumbo）。
- **不**新增 UI、OAuth、登录等。

## 背景与上下文
- 现有模块：`src/pixabay.js`, `src/downloader.js`, `src/tools.js`, `src/server.js`，测试 `tests/tools.test.js` / `tests/e2e.test.js`。
- picjumbo.com 搜索 URL：`https://picjumbo.com/search/{keyword}/page/{n}/`；第 1 页也可以直接 `https://picjumbo.com/search/{keyword}/`。
- 分页探测策略：
  - 从 `page=1` 开始 GET；
  - 在每页 HTML 中寻找分页链接 `.../page/{n}/` 或 `<a>` 指向页码；若能解析出 `最后页` 或 `下一页` 链接，则继续；
  - 若某页 `status=404` 或页面为空、或 HTML 中没有新的详情页 URL，则判定到达最后页；
  - 对每页采集到的详情页 URL 去重（使用 URL 本身作为 key），避免重复下载。
- 结果结构：统一为 `hits`，字段包含 `id, source, previewURL, webformatURL, largeImageURL, user, tags, imageWidth, imageHeight, page_url`。`downloaded/failed` 中新增 `source` 字段（与 `pixabay_id` 并存，便于区分来源 ID 与源）。
- `source` 参数类型：设计为 `string | string[]`。在 Zod schema 中使用 `z.union([z.enum(["pixabay","picjumbo"]), z.array(z.enum(["pixabay","picjumbo"]))]).default(["pixabay"])`；在 JSON Schema 中写作 `{ "oneOf": [{"enum":["pixabay","picjumbo"]}, {"type":"array","items":{"enum":["pixabay","picjumbo"]}}], "default": ["pixabay"] }`。MCP tool 调用传入字符串或数组都允许。
- 并发分派：若 `source` 含多个源，则分别调用对应源的 `searchImages`，按顺序合并 hits，最终再统一走 `concurrentDownloadBatch`；`summary` 写明每个源下载数量。

## 功能需求 (Functional Requirements)
- **FR-1（`src/picjumbo.js`）**:
  - 导出 `async searchImages({ keyword, count })`。
  - 自动翻页到边界：每页获取详情页 URL 列表；收集到 `count` 即停止；未设置上限时采集所有页。
  - 去重：以详情页 URL 或 `image=<id>` 作为去重 key。
  - 解析详情页提取 `largeImageURL`（og:image / 正文大图）、`previewURL/webformatURL`（缩略图）、`user`（作者信息）、`tags`（标题 + keyword 派生）。
  - 输出 hit：`{ id, source="picjumbo", previewURL, webformatURL, largeImageURL, user, tags, imageWidth, imageHeight, page_url }`。
  - 错误类型：`PicjumboScrapeError / NetworkError`。
- **FR-2（`src/tools.js` schema 扩展）**:
  - `source` 改为 `z.union([z.enum(["pixabay","picjumbo"]), z.array(z.enum(["pixabay","picjumbo"]))]).default(["pixabay"])`；内部 normalize 成 `string[]` 后做分派。
  - `searchAndDownloadImagesInputSchema` 对应 JSON Schema 同步为 `oneOf`（字符串或字符串数组），默认 `["pixabay"]`。
- **FR-3（`src/tools.js` handler 分派 & 合并）**:
  - 对每个 source 调用对应的 `searchImages`：
    - `pixabay`：保留 `{ keyword, count, safesearch }`，按比例（或按均等）分配 count 到各源（例如 `count / sources.length`）。
    - `picjumbo`：保留 `{ keyword, count }`。
  - 合并 hits（保持顺序：先 pixabay 的 hits，再 picjumbo 的 hits），最终截取至 `count` 条。
  - 每个 hit 必须带 `source` 字段，以便下载结果与回显区分。
  - 对任一源失败：不崩溃；返回 `isError: true` 的 MCP 内容，错误文本中明确标出是哪个源失败。
- **FR-4（下载结果区分来源）**:
  - `src/downloader.js` 的 `pickUrl / buildFileName` 保持兼容（依赖 `previewURL/webformatURL/largeImageURL/tags/id`）。
  - `concurrentDownloadBatch` 输出的 `downloaded / failed` 项需要新增 `source` 字段（从 hit 中透传）。
  - 字段集合：`local_path, original_url, author, tags, width, height, pixabay_id, source`。其中 `pixabay_id` 在 `source="picjumbo"` 时即为 picjumbo 的图片 id。
- **FR-5（`src/server.js` 同步）**:
  - 将 `server.js` 中的 Zod schema 同步为多值 source（与 tools.js 一致）。
- **FR-6（测试）**:
  - `tests/tools.test.js`：新增断言 `source="unknown"` 报校验错误；默认值为 `["pixabay"]`；允许传入 `"picjumbo"` 字符串或 `["pixabay","picjumbo"]` 数组。
  - `tests/picjumbo.test.js`：
    - 单元：`picjumbo.searchImages({ keyword: "nature", count: 5 })` 返回 hits 长度 ≥ 1，且 `source === "picjumbo"`。
    - 单元：无 keyword 返回 `[]`。
    - 端到端：调用 MCP `source="picjumbo"`，断言 `downloaded` 项 `source === "picjumbo"`，文件存在且 size > 10KB。
  - `tests/e2e.test.js` 保持不变（默认 `["pixabay"]`），仍验证 `downloaded.length === 3` 等。

## 非功能需求 (Non-Functional Requirements)
- **NFR-1（健壮分页）**: 分页边界通过 `404 / 空页 / 无详情 URL / 重复 page` 判定；对未知 HTML 结构应降级为返回现有 hits 而非抛异常。
- **NFR-2（网络可靠）**: 请求超时 30s，重试 1-2 次；并发生成详情页时 `concurrency ≤ 5`。
- **NFR-3（安全）**: 仅下载 host 属于 picjumbo 官方域名的 URL；拒绝跳转至外部站点。
- **NFR-4（不新增依赖）**: 仅使用 Node 内置 `fetch` 与正则解析。

## 约束
- Node.js >= 18；无新 npm 包。
- 测试环境需同时能访问 pixabay.com 与 picjumbo.com。

## 假设
- picjumbo 搜索与详情页结构保持稳定；若有变化，解析规则需改 `picjumbo.js` 即可。
- 单源失败不阻塞整个 MCP 工具返回结果（至少返回成功的源）。

## 验收标准 (Acceptance Criteria)

### AC-1: 不传 `source` 时默认走 `["pixabay"]`，与旧行为一致
- **Given**: 未传 `source`
- **When**: 以 `keyword="nature", save_dir="tmp/e2e-test", count=3` 调用
- **Then**: `downloaded.length === 3`，且每个 item `source === "pixabay"`；旧 E2E 测试通过。
- **Verification**: `programmatic`

### AC-2: `source="picjumbo"` 单源检索+下载
- **Given**: 网络可用
- **When**: `source="picjumbo", keyword="nature", count=3, size="large"`
- **Then**: `downloaded.length >= 1`，每个 item `source === "picjumbo"`，文件 size > 10KB。
- **Verification**: `programmatic`

### AC-3: `source=["pixabay","picjumbo"]` 多源合并
- **Given**: 两个源都可用
- **When**: `source=["pixabay","picjumbo"], keyword="nature", count=6`
- **Then**: payload 中 `downloaded` 至少同时包含 `source="pixabay"` 与 `source="picjumbo"` 项；`summary` 同时提到两个来源。
- **Verification**: `programmatic`

### AC-4: picjumbo 分页能翻到所有页
- **Given**: keyword 返回的总条数较多（> 单页）
- **When**: 不设置 `count` 或设置较大 `count`
- **Then**: `picjumbo.searchImages` 返回 hits 数 ≥ 单页条数；翻页到达边界后自动停止，不产生无限循环。
- **Verification**: `programmatic`

### AC-5: 无效 `source` 在 Zod 层被拦截
- **Given**: 客户端构造 tool 调用
- **When**: `source="unknown"` 或 `source=["pixabay","unknown"]`
- **Then**: 返回参数校验失败错误，不进入业务逻辑。
- **Verification**: `programmatic`

### AC-6: 单源失败返回友好错误，不崩溃
- **Given**: 模拟 picjumbo 不可达
- **When**: `source="picjumbo"` 调用
- **Then**: handler 返回 `isError: true`，错误文本含 `"picjumbo"` 或 `"Network"`。
- **Verification**: `programmatic`

## 开放问题
- 多源时的 `count` 分配策略（平均分配 / 先到先得）— 默认按 `Math.ceil(count / sources.length)` 分配到每源，最后合并再截取到 `count`。
