# photo-get-skill

一个基于 **Model Context Protocol (MCP)** 的图片抓取工具服务器。通过指定关键词，从多个免版权图库（Pixabay、Picjumbo）搜索并下载图片到本地目录。

## 功能

- 按关键词搜索免版权图片，支持多图库来源
- 指定下载数量（1–200），多来源时自动分配数量并去重
- 选择图片尺寸（预览图 / 网络尺寸 / 原始大图）
- 安全搜索（过滤成人内容，Pixabay 来源）
- 返回每张图片的本地路径、URL、作者、标签、来源等元数据

## 图片来源

| 来源 | 说明 | API Key |
| --- | --- | --- |
| `pixabay` | Pixabay 官方 REST API，结果稳定、元数据完整（宽高、作者等） | 需要（默认内置公开 Key） |
| `picjumbo` | 通过 Web Archive 抓取 picjumbo.com 搜索页解析图片链接，依赖 web.archive.org 可访问性 | 不需要 |

默认只使用 `pixabay`；`picjumbo` 检索较慢（需逐页抓取归档页面），适合作为补充来源。

## 环境要求

- **Node.js >= 18**（需要原生 ESM 支持和 `fetch` API）
- 可访问互联网（访问 `pixabay.com`、`cdn.pixabay.com` 和 `web.archive.org`）

## 安装

```bash
npm install
```

依赖：
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — MCP 协议实现
- [`zod`](https://www.npmjs.com/package/zod) — 参数校验

## 配置 API Key（可选）

Pixabay 来源默认内置 evergreen.photos 使用的公开 API Key。如需使用自己的 Key（可在 https://pixabay.com/api/docs/ 免费申请），设置环境变量：

```bash
# Linux / macOS
export PHOTO_GET_API_KEY=your_key_here

# Windows (PowerShell)
$env:PHOTO_GET_API_KEY = "your_key_here"
```

`picjumbo` 来源无需 API Key。

## 使用方式

### 1. 作为 MCP 服务器（推荐）

启动服务器，它通过 stdin/stdout 与 MCP 客户端通信：

```bash
npm start
# 等价于 node src/server.js
```

### 2. 在 Claude Desktop / Trae / Cursor 等 MCP 客户端中配置

将服务器添加到 MCP 客户端的配置文件中。

**Claude Desktop 配置示例**（macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows: `%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "photo-get-skill": {
      "command": "node",
      "args": [
        "d:/Program/photo-get-mcp/src/server.js"
      ]
    }
  }
}
```

> 路径请替换为你的实际项目路径。Windows 路径建议用正斜杠 `/`。

重启客户端后，助手即可发现并调用 `search_and_download_images` 工具。

### 3. 直接命令行测试各图库来源

```bash
# 搜索 Pixabay "nature" 并获取前 5 张图片元数据
node src/pixabay.js nature 5

# 搜索 Picjumbo "nature"（走 web.archive.org，较慢）
node src/picjumbo.js nature 3

# 单独测试下载器
node src/downloader.js
```

## MCP 工具说明

### `search_and_download_images`

按关键词搜索并下载图片到指定目录。

**参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `keyword` | string | ✅ | — | 搜索关键词，例如 `nature`、`cat`、`landscape` |
| `save_dir` | string | ✅ | — | 图片保存目录（绝对路径或相对路径），不存在会自动创建 |
| `count` | number | — | 10 | 下载数量，范围 1–200，多来源时自动分配 |
| `size` | string | — | `webformat` | 图片尺寸：`preview`（150px）/ `webformat`（640px）/ `large`（原图） |
| `safesearch` | boolean | — | true | 是否启用安全搜索（仅对 Pixabay 生效） |
| `source` | string \| string[] | — | `["pixabay"]` | 图片来源，可选 `"pixabay"`、`"picjumbo"`、`"pixabay,picjumbo"` 或数组 `["pixabay","picjumbo"]` |

**返回（JSON 文本）：**

```jsonc
{
  "total": 3,
  "sources": ["pixabay", "picjumbo"],
  "source_counts": { "pixabay": 2, "picjumbo": 1 },
  "downloaded": [
    {
      "local_path": "D:/.../nature/7373484-landscape.jpg",
      "original_url": "https://cdn.pixabay.com/photo/...jpg",
      "author": "Kanenori",
      "tags": "landscape, rainbow, beautiful nature",
      "width": 3150,
      "height": 2100,
      "id": 7373484,
      "source": "pixabay",
      "pixabay_id": 7373484
    }
    // ...
  ],
  "failed": [],
  "search_warnings": [],
  "save_dir": "D:/.../nature",
  "summary": "已下载 3 张图片至 nature，0 张失败。关键词: nature，来源: pixabay, picjumbo"
}
```

> `pixabay_id` 字段为向后兼容保留，新代码请使用 `id` 与 `source`。单一来源失败时不会中断整体搜索，错误会出现在 `search_warnings` 中。

**示例调用（告诉助手）：**

> 帮我从 pixabay 和 picjumbo 搜索 5 张 `sunset beach` 主题的大图，保存到 `D:/images/sunset/`

## 项目结构

```
photo-get-mcp/
├── src/
│   ├── server.js        # MCP 服务器入口：薄注册层，遍历 tools.js 注册工具
│   ├── tools.js         # 工具 schema、handler、来源归一化与多来源搜索（单一事实来源）
│   ├── pixabay.js       # Pixabay API 客户端（含 CLI 测试入口）
│   ├── picjumbo.js      # Picjumbo 抓取客户端，走 Web Archive（含 CLI 测试入口）
│   └── downloader.js    # 图片下载 + 目录管理 + 并发控制（含 CLI 测试入口）
├── tests/
│   ├── tools.test.js            # Zod schema 校验测试
│   ├── picjumbo.test.js         # source 参数与 picjumbo/downloader 功能测试
│   ├── server-handshake.test.js # MCP 握手测试
│   └── e2e.test.js              # 端到端真实下载测试
├── tmp/                 # 测试和下载产物（git 忽略）
├── package.json
├── LICENSE
└── README.md
```

## 测试

```bash
npm test          # 全量测试（含真实网络下载的 e2e 测试）
npm run test:fast # 跳过 e2e 下载测试，速度快
```

测试套件覆盖：参数校验、多来源 schema、MCP 握手、工具列表、真实网络下载。

**测试结果示例：**

```
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

## 关于图片来源与版权

- Pixabay：本工具直接接入 Pixabay 公开 REST API，图片遵循 [Pixabay Content License](https://pixabay.com/service/license-summary/)（免费商用，无需署名）。
- Picjumbo：picjumbo.com 已停止服务，本工具通过 Web Archive 读取其历史页面；图片遵循 Picjumbo 原免费许可条款。

## 许可证

[MIT](./LICENSE)
