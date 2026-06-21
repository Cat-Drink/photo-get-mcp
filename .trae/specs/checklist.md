# evergreen.photos 图片抓取 MCP - 验证清单 (Checklist)

## 项目级验证
- [ ] `package.json` 存在，包含 `@modelcontextprotocol/sdk` 与 `zod` 依赖。
- [ ] `.gitignore` 存在，忽略 `node_modules/`、`tmp/`、`.env`。
- [ ] README.md 存在，包含安装、运行、MCP 客户端配置、示例。

## 模块级验证 (src/pixabay.js)
- [ ] `searchImages({ keyword: "nature", count: 3 })` 返回非空 hits 数组，每个 hit 含 `id / webformatURL / largeImageURL / user / tags / imageWidth / imageHeight`。
- [ ] 使用无效 API Key 时抛出带 "Invalid" 消息的错误。
- [ ] `count > 200` 时分页合并返回结果，不超过 count 与 500 上限。
- [ ] 网络不可达时抛出明确错误，不吞掉异常。

## 模块级验证 (src/downloader.js)
- [ ] `ensureDir` 能递归创建不存在的目录。
- [ ] `pickUrl(hit, "webformat")` 返回 hit 中 `webformatURL`。
- [ ] `buildFileName` 将 tag slug 化，文件名形如 `<id>-<slug>.jpg`。
- [ ] `downloadImage` 成功将一张已知 URL 的图片写到本地，文件大小 > 10KB。
- [ ] `downloadImage` 对无效 URL 重试 2 次后最终返回失败，不抛出进程异常。
- [ ] `concurrentDownloadBatch` 将结果分桶到 `{ downloaded, failed }`。

## 模块级验证 (src/tools.js)
- [ ] schema 校验：`keyword=""` / `count=500` / `size="huge"` 会失败。
- [ ] schema 校验：缺省参数时默认值 `count=10`、`size=webformat`、`safesearch=true`。
- [ ] handler 返回值结构含 `total / downloaded / failed / save_dir / summary`。
- [ ] handler 遇到 Pixabay API 错误时返回 `isError: true` 的 MCP content，不使服务器进程崩溃。

## MCP 服务器级验证 (src/server.js)
- [ ] `node src/server.js` 启动后进程常驻（不立即退出）。
- [ ] 手动向 stdin 写入 MCP `initialize` → `tools/list` 请求，stdout 中能解析到含 `search_and_download_images` 的 JSON-RPC 响应。
- [ ] 写入一条 `callTool` 请求（keyword="nature"，count=3，save_dir="tmp/mcp-test"），响应 JSON-RPC result 的 `content[0].text` 能反序列化为含 `downloaded` 的对象。
- [ ] 进程崩溃时，stdout 未混入非 JSON-RPC 内容（console.error 写到 stderr）。

## 端到端验证
- [ ] 执行 `node tests/e2e.test.js` 退出码为 0。
- [ ] 测试执行后，`tmp/e2e/` 目录下至少有 3 个非空 `.jpg` 文件。
- [ ] 测试断言返回 JSON 中 `downloaded.length === 3` 且每个 `local_path` 存在且非空。
- [ ] 测试断言 `summary` 字段包含 "已下载 3 张" 字样。

## 人工评审 (human-judgement)
- [ ] README 中 MCP 客户端配置示例是可直接复制使用的（例如 `claude_desktop_config.json` 片段）。
- [ ] README 解释了 `keyword / save_dir / count / size / safesearch` 各参数含义与默认值。
- [ ] README 提及了 `PHOTO_GET_API_KEY` 环境变量覆盖机制，并声明遵守 Pixabay License。
- [ ] 核心模块职责清晰：`pixabay.js` / `downloader.js` / `tools.js` / `server.js` 各司其职。
- [ ] 代码中没有硬编码的路径分隔符（统一使用 `path.join`）。
