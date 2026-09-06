<div align="center">

# 📸 photo-get-mcp

**基于 Model Context Protocol (MCP) 的多图库图片抓取服务器**

一句话指令，从 Pixabay / Picjumbo 搜索免版权图片并直接下载到本地。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/Protocol-MCP-7c3aed)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-26%20passing-brightgreen)](#-测试)

</div>

---

## ✨ 功能特性

- 🔍 **按关键词搜索**免版权图片，支持多图库来源
- 🔢 **批量下载** 1–200 张，多来源时自动分配数量并去重
- 📐 **三种尺寸**可选：预览图（150px）/ 网络尺寸（640px）/ 原始大图
- 🛡️ **安全搜索**过滤成人内容（Pixabay 来源）
- 📋 **完整元数据**返回：本地路径、URL、作者、标签、来源等

## 🖼️ 图片来源

| 来源 | 说明 | API Key |
|:---:| --- |:---:|
| `pixabay` | Pixabay 官方 REST API，结果稳定、元数据完整（宽高、作者等） | 需要¹ |
| `picjumbo` | 通过 Web Archive 抓取 picjumbo.com 历史页面解析图片链接，检索较慢 | 不需要 |

> ¹ 默认内置公开 API Key，可直接使用。默认只启用 `pixabay`；`picjumbo` 依赖 web.archive.org 的可访问性，适合作为补充来源。

## 📦 安装

```bash
git clone https://github.com/Cat-Drink/photo-get-mcp.git
cd photo-get-mcp
npm install
```

**环境要求：** Node.js ≥ 18（原生 ESM + `fetch`），可访问互联网。

## 🔑 配置 API Key（可选）

如需使用自己的 Pixabay Key（可在 [pixabay.com/api/docs](https://pixabay.com/api/docs/) 免费申请）：

```bash
# Linux / macOS
export PHOTO_GET_API_KEY=your_key_here

# Windows (PowerShell)
$env:PHOTO_GET_API_KEY = "your_key_here"
```

`picjumbo` 来源无需 API Key。

## 🚀 使用方式

### 1️⃣ 作为 MCP 服务器（推荐）

```bash
npm start
```

服务器通过 stdin/stdout 与 MCP 客户端通信。

### 2️⃣ 在 MCP 客户端中配置

**Claude Desktop**（macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows: `%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "photo-get-mcp": {
      "command": "node",
      "args": [
        "d:/Program/photo-get-mcp/src/server.js"
      ]
    }
  }
}
```

> 路径请替换为你的实际项目路径，Windows 建议使用正斜杠 `/`。同样适用于 Trae、Cursor 等支持 MCP 的客户端。

重启客户端后，助手即可发现并调用 `search_and_download_images` 工具。

### 3️⃣ 命令行测试

```bash
node src/pixabay.js nature 5    # 搜索 Pixabay "nature"
node src/picjumbo.js nature 3   # 搜索 Picjumbo（走 Web Archive，较慢）
node src/downloader.js          # 单独测试下载器
```

## 🛠️ MCP 工具

### `search_and_download_images`

按关键词搜索并下载图片到指定目录。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | :---: | :---: | --- | --- |
| `keyword` | `string` | ✅ | — | 搜索关键词，如 `nature`、`cat`、`landscape` |
| `save_dir` | `string` | ✅ | — | 保存目录（绝对/相对路径），不存在会自动创建 |
| `count` | `number` | — | `10` | 下载数量 1–200，多来源时自动分配 |
| `size` | `string` | — | `webformat` | `preview`（150px）/ `webformat`（640px）/ `large`（原图） |
| `safesearch` | `boolean` | — | `true` | 安全搜索（仅对 Pixabay 生效） |
| `source` | `string \| string[]` | — | `["pixabay"]` | `"pixabay"`、`"picjumbo"`、`"pixabay,picjumbo"` 或数组 |

<details>
<summary><b>📤 返回示例</b>（点击展开）</summary>

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

> `pixabay_id` 为向后兼容保留，新代码请使用 `id` 与 `source`。单一来源失败不会中断整体搜索，错误记录在 `search_warnings` 中。

</details>

**💬 示例指令（告诉助手）：**

> 帮我从 pixabay 和 picjumbo 搜索 5 张 `sunset beach` 主题的大图，保存到 `D:/images/sunset/`

## 📁 项目结构

```
photo-get-mcp/
├── src/
│   ├── server.js        # MCP 服务器入口：薄注册层
│   ├── tools.js         # 工具 schema、handler、多来源搜索（单一事实来源）
│   ├── pixabay.js       # Pixabay API 客户端（含 CLI 入口）
│   ├── picjumbo.js      # Picjumbo 抓取客户端，走 Web Archive（含 CLI 入口）
│   └── downloader.js    # 图片下载 + 目录管理 + 并发控制（含 CLI 入口）
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

## 🧪 测试

```bash
npm test          # 全量测试（含真实网络下载的 e2e）
npm run test:fast # 跳过 e2e，速度快
```

覆盖：参数校验、多来源 schema、MCP 握手、工具列表、真实网络下载。

```
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

## 📄 版权与许可

- **Pixabay 图片**：遵循 [Pixabay Content License](https://pixabay.com/service/license-summary/)，免费商用、无需署名。
- **Picjumbo 图片**：picjumbo.com 已停止服务，本工具通过 Web Archive 读取其历史页面；遵循原 Picjumbo 免费许可条款。
- **本项目代码**：[MIT License](./LICENSE)
