# evergreen.photos 图片抓取 MCP - 实现计划 (Implementation Plan / Tasks)

## [ ] Task 1: 项目脚手架初始化
- **Priority**: P0
- **Depends On**: None
- **Description**:
  - 在 `d:\Program\photo-get-skill` 下执行 `npm init -y` 生成 `package.json`。
  - 安装依赖：`@modelcontextprotocol/sdk`、`zod`；添加 `engines: { node: ">=18" }`。
  - 创建基础目录结构：`src/`、`tests/`、`examples/`。
  - 创建 `.gitignore`（忽略 `node_modules/`、`tmp/`、`*.log`、`.env`）。
- **Acceptance Criteria Addressed**: 为 FR-1、FR-12 打基础
- **Test Requirements**:
  - `programmatic` TR-1.1: 运行 `npm install` 成功退出（exit code 0）。
  - `programmatic` TR-1.2: `package.json` 中 `dependencies` 含 `@modelcontextprotocol/sdk` 与 `zod`。
  - `programmatic` TR-1.3: `src/`、`tests/` 目录存在。
- **Notes**: 保持 `package.json` 的 `name` 为 `photo-get-skill`，`main` 指向 `src/server.js`。

## [ ] Task 2: Pixabay API 客户端模块 (src/pixabay.js)
- **Priority**: P0
- **Depends On**: Task 1
- **Description**:
  - 导出 `searchImages({ keyword, perPage, page, safesearch, apiKey })` 函数。
  - 对 `keyword` 做 URL encode；对响应做 JSON 解析与错误处理（网络错误、400 Invalid key）。
  - 对 `count > 200` 进行多次分页聚合（最多 500 条）。
  - 统一的错误类型：`PixabayApiError`（带 HTTP status）与 `NetworkError`。
  - 默认 API Key 来源于代码内常量 + 允许环境变量 `PHOTO_GET_API_KEY` 覆盖。
- **Acceptance Criteria Addressed**: FR-4、AC-2、AC-4
- **Test Requirements**:
  - `programmatic` TR-2.1: `await searchImages({ keyword: "nature", count: 3 })` 返回 `hits.length===3`。
  - `programmatic` TR-2.2: 使用无效 Key 调用时抛出 `PixabayApiError`（message 含 "Invalid"）。
  - `programmatic` TR-2.3: `count=250` 时能正确分页，返回最多 250 条，不超过 500 条限制。
  - `programmatic` TR-2.4: 返回 hit 项含 `id, webformatURL, largeImageURL, previewURL, user, tags, imageWidth, imageHeight`。

## [ ] Task 3: 图片下载器模块 (src/downloader.js)
- **Priority**: P0
- **Depends On**: Task 1
- **Description**:
  - `downloadImage(url, destPath, { retries: 2, timeout: 30_000 })`：流式写入到临时文件，成功后重命名；失败重试。
  - `ensureDir(dir)`：使用 `fs.mkdirSync(path, { recursive: true })`。
  - `pickUrl(hit, size)`：根据 `size ∈ { preview, webformat, large }` 选择对应 URL。
  - `slugify(s)`：只保留字母数字和 `-`，替换空格为 `-`。
  - `buildFileName(hit)`：`<pixabay_id>-<slug_first_tag>.jpg`。
  - `concurrentDownloadBatch(items, dir, { concurrency: 5, size })`：并发下载，结果分桶到 `downloaded / failed` 列表。
  - 下载后校验 `fs.stat.size > 0`，否则抛错进入重试。
- **Acceptance Criteria Addressed**: FR-5、FR-6、FR-7、FR-8、FR-9、AC-6
- **Test Requirements**:
  - `programmatic` TR-3.1: `ensureDir("tmp/sub/nested")` 创建多层目录。
  - `programmatic` TR-3.2: 调用 `downloadImage` 下载一张已知图片 URL，本地文件 `size > 10_000`。
  - `programmatic` TR-3.3: 对不可达 URL `http://0.0.0.0:1/nothing.jpg` 调用 `downloadImage`，返回失败，不抛出进程级异常。
  - `programmatic` TR-3.4: `buildFileName({id:123, tags:"sunset, beach"})` 返回 `123-sunset.jpg`。

## [ ] Task 4: MCP Tool 处理器 (src/tools.js)
- **Priority**: P0
- **Depends On**: Task 2, Task 3
- **Description**:
  - 使用 `zod` 定义 `searchAndDownloadImagesSchema`（keyword, save_dir, count, size, safesearch）。
  - 导出 `tools` 数组（供 MCP Server 注册）及对应 `handler`。
  - handler 流程：参数校验 → 调用 `searchImages` → `ensureDir(save_dir)` → `concurrentDownloadBatch` → 组装 `{ total, downloaded, failed, save_dir, summary }` 并作为 MCP 文本/JSON 内容返回。
  - 对异常情况（网络/无效 Key）捕获，返回 `{ isError: true, text: "..." }` 的 MCP 内容而不崩溃。
  - `summary` 文本字段："已下载 X 张图片至 <save_dir>，Y 张失败"。
- **Acceptance Criteria Addressed**: FR-3、FR-10、AC-1、AC-5
- **Test Requirements**:
  - `programmatic` TR-4.1: schema 对 `keyword=""` 校验失败；对 `count=500` 校验失败；对 `size="huge"` 校验失败。
  - `programmatic` TR-4.2: schema 对合法输入校验通过，默认值正确（count=10, size=webformat, safesearch=true）。
  - `programmatic` TR-4.3: handler 端到端调用（keyword=forest, save_dir=tmp/test-forest）返回 `total === downloaded.length`，目录下出现对应文件。

## [ ] Task 5: MCP 服务器入口 (src/server.js)
- **Priority**: P0
- **Depends On**: Task 4
- **Description**:
  - 使用 `@modelcontextprotocol/sdk` 的 `Server` + `StdioServerTransport` 启动。
  - 在启动时调用 `server.setRequestHandler(listToolsRequestSchema, ...)` 返回 `search_and_download_images` tool。
  - 注册 `callToolRequestSchema` handler，分发到 `src/tools.js`。
  - `process` 级别 `uncaughtException` / `unhandledRejection` 监听器，写到 `console.error` 而不污染 stdout（避免破坏 MCP JSON-RPC）。
- **Acceptance Criteria Addressed**: G1、G2、FR-2、NFR-3
- **Test Requirements**:
  - `programmatic` TR-5.1: `node src/server.js` 能接受 MCP 启动握手：echo 一个 `tools/list` 请求并得到含 `search_and_download_images` 的响应。
  - `programmatic` TR-5.2: 运行时写入一条非法请求到 stdin 不会导致进程崩溃退出。

## [ ] Task 6: 端到端测试与脚本
- **Priority**: P1
- **Depends On**: Task 5
- **Description**:
  - `tests/e2e.test.js`：直接以子进程方式启动 MCP 服务器，模拟 MCP 握手，发送 `callTool`，断言 JSON 结果中 `downloaded` 列表长度 ≥ 1，且文件实际存在。
  - `examples/sample_call.json`：提供一个示例 MCP JSON-RPC 请求体。
  - `bin/run.sh` / `bin/run.bat`：不强制；可跳过，改为 README 直接写命令。
- **Acceptance Criteria Addressed**: AC-1、AC-2、AC-3、AC-6
- **Test Requirements**:
  - `programmatic` TR-6.1: `node tests/e2e.test.js` 退出码 0，`tmp/e2e/` 下至少出现 3 个 jpg。
  - `programmatic` TR-6.2: 测试中使用 `keyword="nature"`、`count=3`、`size="webformat"`，返回 `summary` 含 "已下载 3 张" 字样。

## [ ] Task 7: README 与使用说明
- **Priority**: P1
- **Depends On**: Task 1-5
- **Description**:
  - 根目录 `README.md`：功能介绍、安装步骤（`npm install`）、环境变量说明（`PHOTO_GET_API_KEY`）、MCP 客户端配置示例（例如 Claude Desktop 的 `config.json` 片段）。
  - 给出 2-3 个示例（nature 关键词、限定数量、使用 large 尺寸）。
  - 注意安全说明：不要提交真实 API Key；遵守 Pixabay ToS。
- **Acceptance Criteria Addressed**: FR-12、AC-7
- **Test Requirements**:
  - `human-judgement` TR-7.1: README 包含最小可运行片段 `npm install && node src/server.js` 以及 MCP 客户端配置示例。
  - `human-judgement` TR-7.2: README 解释了 `search_and_download_images` 每个参数的含义与默认值。

## 依赖关系图（DAG）

```
Task 1 (脚手架)
 ├──> Task 2 (pixabay.js) ──┐
 └──> Task 3 (downloader.js)─┼──> Task 4 (tools.js) ──> Task 5 (server.js) ──> Task 6 (E2E 测试)
                             └───────────────────────────────────────────────> Task 7 (README)
```

## 技术实现要点
- **MCP SDK 使用**：`new Server({ name: "photo-get-skill", version: "1.0.0" })`，然后 `connect(new StdioServerTransport())`。
- **工具声明**：`server.setRequestHandler(ListToolsRequestSchema, ...)` 返回包含 `{ name, description, inputSchema: z.object({...}) }` 的列表。
- **工具调用**：`server.setRequestHandler(CallToolRequestSchema, async (req) => {...})`；返回 `{ content: [{ type: "text", text: JSON.stringify(result) }], isError: false }`。
- **网络请求**：使用 Node.js `https` 或 `fetch`（Node 18 内置），避免额外依赖。
- **下载并发控制**：使用简单的 Promise 批次（每批 5 个），或 `p-limit` 风格实现。避免引入过多依赖。
- **测试方式**：`node:test` + `assert`（无需 jest/mocha）。E2E 测试通过 `child_process.spawn` 启动 server 并写入 MCP JSON-RPC 消息到子进程 stdin；解析 stdout 中 JSON-RPC 响应。
