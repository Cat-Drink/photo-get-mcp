# photo-get-skill

一个基于 **Model Context Protocol (MCP)** 的图片抓取工具服务器。通过指定关键词，从 Pixabay 图片库（evergreen.photos 背后的数据源）搜索并下载图片到本地目录。

## 功能

- 按关键词搜索免版权图片
- 指定下载数量（1–200）
- 选择图片尺寸（预览图 / 网络尺寸 / 原始大图）
- 安全搜索（过滤成人内容）
- 返回每张图片的本地路径、URL、作者、标签、尺寸等元数据

## 环境要求

- **Node.js >= 18**（需要原生 ESM 支持和 `fetch` API）
- 可访问互联网（访问 `pixabay.com` 和 `cdn.pixabay.com`）

## 安装

```bash
npm install
```

依赖：
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — MCP 协议实现
- [`zod`](https://www.npmjs.com/package/zod) — 参数校验

## 配置 API Key

默认内置了 evergreen.photos 使用的公开 API Key。如需使用自己的 Key（可在 https://pixabay.com/api/docs/ 免费申请），设置环境变量：

```bash
# Linux / macOS
export PHOTO_GET_API_KEY=your_key_here

# Windows (PowerShell)
$env:PHOTO_GET_API_KEY = "your_key_here"
```

## 使用方式

### 1. 作为 MCP 服务器（推荐）

启动服务器，它通过 stdin/stdout 与 MCP 客户端通信：

```bash
node src/server.js
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
        "d:/Program/photo-get-skill/src/server.js"
      ]
    }
  }
}
```

> 路径请替换为你的实际项目路径。Windows 路径建议用正斜杠 `/`。

重启客户端后，助手即可发现并调用 `search_and_download_images` 工具。

### 3. 直接运行 Pixabay 搜索测试

```bash
# 搜索 "nature" 并获取前 5 张图片元数据
node src/pixabay.js nature 5
```

## MCP 工具说明

### `search_and_download_images`

按关键词搜索并下载图片到指定目录。

**参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `keyword` | string | ✅ | — | 搜索关键词，例如 `nature`、`cat`、`landscape` |
| `save_dir` | string | ✅ | — | 图片保存目录（绝对路径或相对路径），不存在会自动创建 |
| `count` | number | — | 10 | 下载数量，范围 1–200 |
| `size` | string | — | `webformat` | 图片尺寸：`preview`（150px）/ `webformat`（640px）/ `large`（原图） |
| `safesearch` | boolean | — | true | 是否启用安全搜索 |

**返回（JSON 文本）：**

```jsonc
{
  "total": 3,
  "downloaded": [
    {
      "local_path": "D:/.../tmp/nature/7373484-landscape.jpg",
      "original_url": "https://cdn.pixabay.com/photo/...jpg",
      "author": "Kanenori",
      "tags": "landscape, rainbow, beautiful nature",
      "width": 3150,
      "height": 2100,
      "pixabay_id": 7373484
    }
    // ...
  ],
  "failed": [],
  "save_dir": "D:/.../tmp/nature",
  "summary": "已下载 3 张图片至 tmp/nature，0 张失败。关键词: nature"
}
```

**示例调用（告诉助手）：**

> 帮我搜索 5 张 `sunset beach` 主题的大图，保存到 `D:/images/sunset/`

## 项目结构

```
photo-get-skill/
├── src/
│   ├── server.js        # MCP 服务器入口（McpServer + StdioServerTransport）
│   ├── tools.js         # 工具 schema、handler（单元测试使用）
│   ├── pixabay.js       # Pixabay API 客户端
│   └── downloader.js    # 图片下载 + 目录管理 + 并发控制
├── tests/
│   ├── tools.test.js          # Zod schema 校验测试（4 用例）
│   ├── server-handshake.test.js # MCP 握手测试（4 用例）
│   └── e2e.test.js            # 端到端下载测试（8 用例）
├── tmp/                 # 测试和下载产物（git 忽略）
├── package.json
└── README.md
```

## 测试

```bash
node --test tests/tools.test.js tests/server-handshake.test.js tests/e2e.test.js
```

测试套件覆盖：参数校验、MCP 握手、工具列表、真实网络下载。

**测试结果示例：**

```
# tests 18
# pass 18
# fail 0
```

## 关于 evergreen.photos

evergreen.photos 本身无自有图片数据库，其前端直接调用 Pixabay 的公开 REST API。因此本工具直接接入 Pixabay API 以实现程序化抓取。图片版权遵循 Pixabay Content License（免费商用，无需署名）。

## 许可证

MIT
