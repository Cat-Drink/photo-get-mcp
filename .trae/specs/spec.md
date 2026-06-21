# evergreen.photos 图片抓取 MCP - 产品需求文档 (PRD)

## Overview
- **Summary**: 开发一个基于 Model Context Protocol (MCP) 的图片抓取工具服务器。用户通过指定关键词（keyword），即可从 evergreen.photos 网站（底层为 Pixabay API）搜索并下载相关图片，保存到本地指定目录，同时返回图片元数据（标题、作者、来源 URL、原始尺寸等）。
- **Purpose**: 为需要大量免版税图片素材的 LLM 应用和工作流提供稳定、可编程的图片获取能力；绕开 evergreen.photos 的 Web UI，直接使用其后端 Pixabay API 进行程序化搜索和下载。
- **Target Users**:
  - LLM 应用开发者（接入 MCP 协议的 Claude/Trae 等助手）
  - 内容创作者（需批量获取素材）
  - 爬虫/数据工程工作流

## 技术发现（前置调研结论）
- evergreen.photos 是一个前端 SPA（React + Material-UI），无自己的图片数据库。
- 它在前端直接调用 **Pixabay API**：`https://pixabay.com/api/?key=<KEY>&q=<KEYWORD>&image_type=photo&per_page=51&safesearch=true`
- 前端源码 `index_bundle.js` 中暴露的 `apiKey` 为 `f101e2fbc08853f24c497feb6-34000831`，并在运行时 `.split('').reverse().join('')` 后拼接进 URL。
- **实际可用 API Key**（已实测返回 200 + 图片数据）：`13800043-6bef794c42f35880cbf2e101f`
- API 响应的 `hits[*]` 字段中，可用下载链接：
  - `previewURL`（150px 宽，最小）
  - `webformatURL`（默认 640px）
  - `largeImageURL`（最大原始尺寸）
- 图片实际下载 URL 在 `cdn.pixabay.com` 域名下，无反爬限制，简单 HTTP GET 即可下载。
- Pixabay 免费 API 速率限制：每分钟 100 次请求。

## Goals
- [G1] 提供一个符合 **MCP (Model Context Protocol) 1.0** 规范的 **工具服务器**（stdin/stdout 或 SSE）。
- [G2] 暴露 **至少一个 MCP tool**：`search_and_download_images`，接受关键词、保存路径、数量、尺寸等参数。
- [G3] 成功执行后，图片被下载到用户指定本地目录，文件名包含图片 ID + 标题 slug，避免重名覆盖。
- [G4] 工具返回结构化 JSON 结果，包含每张图片的本地路径、原始 URL、作者、标签、尺寸等元数据。
- [G5] 提供配置化的 API Key（环境变量或配置文件），默认使用从 evergreen.photos 分析出的 Key，并允许用户替换为自己的 Pixabay Key。
- [G6] 跨平台支持（Windows / macOS / Linux），Node.js 实现。

## Non-Goals (Out of Scope)
- **不**提供图形化 UI（本项目聚焦 MCP 协议层）。
- **不**实现图片编辑、OCR、压缩等后处理功能。
- **不**实现用户账户/书签功能（对应 evergreen.photos 的登录功能）。
- **不**实现视频/插画的搜索（`image_type=photo` 固定）。
- **不**使用无头浏览器/Playwright 进行前端抓取，因为已暴露的 REST API 更稳定且符合 Pixabay ToS。

## 背景与上下文
- MCP 协议由 Anthropic 定义，允许 LLM 通过标准 JSON-RPC 调用外部工具。
- MCP 服务器通常通过 stdio（子进程）或 HTTP (SSE) 与客户端通信。
- 当前工作目录 `d:\Program\photo-get-skill` 为空目录，需全新搭建 Node.js 项目。
- 使用 `@modelcontextprotocol/sdk` npm 包作为官方 SDK。
- 使用 Node.js 原生 `https` 或轻量 `axios/fetch` 进行 API 调用和图片下载。

## 功能需求 (Functional Requirements)
- **FR-1**: 初始化一个 npm 项目（package.json + 依赖：`@modelcontextprotocol/sdk`、`zod`）。
- **FR-2**: 实现 MCP 服务器入口 `src/server.js`，在启动时向客户端声明一个 `search_and_download_images` tool。
- **FR-3**: `search_and_download_images` 的参数 Schema（基于 Zod）：
  - `keyword`（string，必填，1-100 字符）
  - `save_dir`（string，必填，绝对或相对路径）
  - `count`（number，默认 10，范围 1-200）
  - `size`（string，枚举 `large|webformat|preview`，默认 `webformat`）
  - `safesearch`（boolean，默认 true）
- **FR-4**: 调用 Pixabay API 获取图片元数据；当 `count > 200` 时自动分批（`per_page=200` + `page` 分页），Pixabay 总限制为最多返回 500 条。
- **FR-5**: 若 `save_dir` 不存在，自动创建（含多级目录）。
- **FR-6**: 并发/顺序下载多张图片至本地；默认并发数 5（可配），避免触发 Pixabay 速率限制。
- **FR-7**: 文件名格式：`<pixabay_id>-<slugified_first_tag>.<ext>`；扩展根据 Content-Type 或 URL 推断（通常为 jpg）。
- **FR-8**: 下载失败（超时/4xx/5xx）时重试最多 2 次；仍然失败则记录到返回结果的 `failed` 列表，不中断整个批次。
- **FR-9**: 图片下载时校验 Content-Length / 实际写入大小非零；零字节文件视为失败。
- **FR-10**: 工具返回 JSON 结果结构：`{ total: n, downloaded: [...], failed: [...], save_dir: string }`；每项包含 `local_path, original_url, author, tags, width, height, pixabay_id`。
- **FR-11**: 允许通过环境变量 `PHOTO_GET_API_KEY` 覆盖默认 API Key；未设置时回退到内置 Key。
- **FR-12**: 提供 `README` 用法说明（MCP 客户端配置方式、可用 tools、示例调用）。

## 非功能需求 (Non-Functional Requirements)
- **NFR-1 (可靠性)**: 单张图片下载失败不影响其他图片。
- **NFR-2 (性能)**: 5 张并发下载 + 分批获取元数据，100 张图片的完整抓取应在 60 秒内完成（视网络而定）。
- **NFR-3 (可观测性)**: 通过 `console.error` 输出日志，MCP 协议日志与业务日志分流；工具返回值中自带 `summary` 文本字段以便 LLM 直接阅读。
- **NFR-4 (安全性)**: 不记录/上传用户本地路径；API Key 不从日志输出。
- **NFR-5 (跨平台)**: 路径拼接统一使用 `path.join`，不硬编码 `\` 或 `/`。
- **NFR-6 (可维护性)**: 核心逻辑拆分为独立模块：`src/pixabay.js` (API 客户端)、`src/downloader.js` (下载/重试)、`src/tools.js` (MCP tool 处理器)、`src/server.js` (服务器入口)。

## 约束
- **技术栈**: Node.js >= 18，npm，`@modelcontextprotocol/sdk`（最新稳定版），`zod`。
- **外部依赖**: 仅 Pixabay API；无数据库、无缓存服务器。
- **API 限制**: Pixabay 每分钟最多 100 请求，`per_page` 最大 200，总结果最多 500。
- **合规**: 遵守 Pixabay Content License（免费商用，无需署名，默认启用 safesearch）。

## 假设
- 用户运行环境有 Node.js >= 18 与可用网络连接。
- evergreen.photos 前端使用的 Pixabay API Key 可持续使用；若失效，用户可通过 `PHOTO_GET_API_KEY` 替换为自己的 Key。
- 用户在 Windows 上使用 MCP 客户端（如 Trae/VS Code/ Claude Desktop）能正确配置 stdio 子进程。

## 验收标准 (Acceptance Criteria)

### AC-1: MCP 服务器启动并正确声明工具
- **Given**: 已执行 `npm install`
- **When**: 执行 `node src/server.js`
- **Then**: 进程不立即退出；通过 MCP `tools/list` 查询能返回包含 `search_and_download_images` 的列表，tool 的 inputSchema 正确描述所有参数。
- **Verification**: `programmatic`

### AC-2: 关键词搜索返回有效图片元数据
- **Given**: 网络可用、API Key 有效
- **When**: 以 `keyword="nature"` 调用 `search_and_download_images`
- **Then**: Pixabay API 返回 200；解析出的 hits 数组非空；每张图片有 `id`、`largeImageURL`/`webformatURL`。
- **Verification**: `programmatic`

### AC-3: 图片成功下载到指定目录且文件非空
- **Given**: 指定了一个不存在的目录 `./tmp/nature-images`
- **When**: 以 `count=5, size=webformat, save_dir="./tmp/nature-images"` 调用工具
- **Then**: 目录被自动创建；目录下出现至少 5 个 `.jpg` 文件；每个文件大小 > 10KB；返回结果 `downloaded` 列表有 5 项且每项含有效 `local_path`。
- **Verification**: `programmatic`

### AC-4: 无效 API Key / 无网络时返回清晰错误
- **Given**: 环境变量 `PHOTO_GET_API_KEY` 被设置为无效值
- **When**: 调用工具
- **Then**: 工具不崩溃；返回 `isError: true` 的 MCP 内容；错误信息含 "API key" 或 "网络" 提示。
- **Verification**: `programmatic`

### AC-5: 参数校验（非法 count / 空 keyword）
- **Given**: 客户端构造工具调用
- **When**: `count=500` 或 `keyword=""`
- **Then**: MCP 框架级 Zod 校验拦截并返回结构化错误，不进入业务逻辑。
- **Verification**: `programmatic`

### AC-6: 部分图片下载失败不影响其他
- **Given**: 模拟部分 URL 不可达（通过后续注入测试或 mock）
- **When**: 执行批次下载
- **Then**: `downloaded` 列表含成功项，`failed` 列表含失败项及错误原因，工具返回状态为成功。
- **Verification**: `programmatic`

### AC-7: README 与 MCP 客户端配置示例
- **Given**: 用户阅读 README
- **When**: 按照 README 在 MCP 客户端（如 claude_desktop 的 config.json）进行 stdio 配置
- **Then**: 助手能看到并调用 `search_and_download_images` 工具。
- **Verification**: `human-judgment`

## 开放问题
- [ ] 是否需要额外暴露一个纯搜索 tool（仅返回元数据、不下载）？— 暂定不做，如后续需要再加。
- [ ] 是否需要支持按颜色/方向/最小尺寸等 Pixabay 高级筛选？— 暂定第一版仅支持关键词 + safesearch。
- [ ] 图片尺寸选项是否需要支持自定义 `per_page` / 分页？— 已在 FR-4 处理。
