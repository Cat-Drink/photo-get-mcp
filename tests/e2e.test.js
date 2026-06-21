import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const serverScript = path.join(projectRoot, "src", "server.js");

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

class JsonRpcPeer {
  constructor(child) {
    this.child = child;
    this.messages = [];
    this._buffer = "";
    this._pending = [];
    this._attached = false;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    this.child.stdout.on("data", (chunk) => {
      this._buffer += chunk.toString("utf8");
      let idx;
      while ((idx = this._buffer.indexOf("\n")) !== -1) {
        const rawLine = this._buffer.slice(0, idx);
        this._buffer = this._buffer.slice(idx + 1);
        const line = rawLine.trim();
        if (!line) continue;
        const obj = tryParseJsonLine(line);
        if (obj && typeof obj === "object" && "jsonrpc" in obj) {
          this.messages.push(obj);
          this._flushPending();
        }
      }
    });
  }

  _flushPending() {
    const remaining = [];
    for (const entry of this._pending) {
      const match = this.messages.find(entry.predicate);
      if (match) {
        entry.resolve(match);
      } else {
        remaining.push(entry);
      }
    }
    this._pending = remaining;
  }

  send(obj) {
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  waitFor(predicate, timeoutMs = 30000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._pending.findIndex((e) => e.resolve === resolve);
        if (idx !== -1) this._pending.splice(idx, 1);
        reject(new Error("Timeout waiting for matching JSON-RPC message"));
      }, timeoutMs);
      this._pending.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }
}

test("MCP e2e: search_and_download_images 实际调用", { timeout: 60000 }, async (t) => {
  const child = spawn("node", [serverScript], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const peer = new JsonRpcPeer(child);
  peer.attach();

  await t.test("initialize", async () => {
    peer.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.1.0" },
      },
    });

    const resp = await peer.waitFor((m) => m.id === 1);
    assert.ok(resp, "应收到 initialize 响应");
    assert.ok(resp.result);
    assert.ok(resp.result.protocolVersion);
  });

  await t.test("initialized notification", async () => {
    peer.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await new Promise((r) => setTimeout(r, 300));
  });

  await t.test("tools/list 列出工具", async () => {
    peer.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const resp = await peer.waitFor((m) => m.id === 2);
    assert.ok(resp, "应收到 tools/list 响应");
    assert.ok(resp.result);
    assert.ok(Array.isArray(resp.result.tools));
    const names = resp.result.tools.map((tool) => tool.name);
    assert.ok(
      names.includes("search_and_download_images"),
      `应包含 search_and_download_images，实际列表: ${names.join(", ")}`
    );
  });

  let payload;

  await t.test("tools/call search_and_download_images 返回有效响应", async () => {
    peer.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search_and_download_images",
        arguments: {
          keyword: "nature",
          save_dir: "tmp/e2e-test",
          count: 3,
          size: "webformat",
          safesearch: true,
        },
      },
    });

    const resp = await peer.waitFor((m) => m.id === 3, 30000);
    assert.ok(resp, "应收到 tools/call 响应");
    if (resp.error) {
      assert.fail(`tools/call 返回错误: ${JSON.stringify(resp.error)}`);
    }
    assert.ok(resp.result, "响应应包含 result");
    assert.ok(Array.isArray(resp.result.content), "result.content 应为数组");
    assert.ok(resp.result.content.length >= 1, "result.content 至少包含一项");
    assert.equal(
      resp.result.content[0].type,
      "text",
      "result.content[0].type 应为 text"
    );

    const text = resp.result.content[0].text;
    assert.ok(typeof text === "string" && text.length > 0, "text 字段应为非空字符串");

    try {
      payload = JSON.parse(text);
    } catch (err) {
      assert.fail(`无法解析返回的 JSON payload: ${err.message}; text=${text}`);
    }
    assert.ok(payload && typeof payload === "object", "payload 应为对象");
  });

  await t.test("payload.downloaded.length === 3", () => {
    assert.ok(payload, "payload 应存在");
    assert.ok(Array.isArray(payload.downloaded), "payload.downloaded 应为数组");
    assert.equal(payload.downloaded.length, 3, "downloaded 长度应为 3");
  });

  await t.test("每个 downloaded item 字段完整", () => {
    for (const item of payload.downloaded) {
      assert.ok(item && typeof item === "object", "downloaded item 应为对象");
      for (const field of [
        "local_path",
        "original_url",
        "author",
        "tags",
        "width",
        "height",
        "pixabay_id",
      ]) {
        assert.ok(
          field in item,
          `downloaded item 应包含字段 ${field}; 实际 keys=${Object.keys(item).join(", ")}`
        );
      }
    }
  });

  await t.test("每个 local_path 文件存在且大小 > 10KB", () => {
    for (const item of payload.downloaded) {
      const stat = fs.statSync(item.local_path);
      assert.ok(stat.isFile(), `local_path 应存在: ${item.local_path}`);
      assert.ok(
        stat.size > 10 * 1024,
        `文件大小应 > 10KB: ${item.local_path} (${stat.size} bytes)`
      );
    }
  });

  await t.test("summary 中包含 '已下载'", () => {
    assert.ok(typeof payload.summary === "string", "summary 应为字符串");
    assert.ok(
      payload.summary.includes("已下载"),
      `summary 应包含 '已下载'，实际为: ${payload.summary}`
    );
  });

  try {
    child.stdin.end();
  } catch {}
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (!child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});
