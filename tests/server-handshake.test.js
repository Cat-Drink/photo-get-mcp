import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  waitFor(predicate, timeoutMs = 15000) {
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

test("MCP server: initialize + tools/list handshake", async (t) => {
  const child = spawn("node", [serverScript], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString("utf8");
  });

  const peer = new JsonRpcPeer(child);
  peer.attach();

  await t.test("server starts and emits ready log on stderr", () => {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error("Timeout waiting for MCP server ready log"));
      }, 10000);
      const check = () => {
        if (stderrBuf.includes("[photo-get-skill] MCP server ready")) {
          clearTimeout(deadline);
          resolve();
        }
      };
      child.stderr.on("data", check);
      check();
    });
  });

  await t.test("initialize request returns protocolVersion", async () => {
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
    assert.ok(resp.result, "响应应包含 result");
    assert.ok(resp.result.protocolVersion, "result 应包含 protocolVersion");
    assert.ok(resp.result.serverInfo, "result 应包含 serverInfo");
    assert.equal(resp.result.serverInfo.name, "photo-get-skill");
  });

  await t.test("initialized notification accepted", async () => {
    peer.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await new Promise((r) => setTimeout(r, 300));
  });

  await t.test("tools/list returns search_and_download_images tool", async () => {
    peer.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const resp = await peer.waitFor((m) => m.id === 2);
    assert.ok(resp, "应收到 tools/list 响应");
    assert.ok(resp.result, "响应应包含 result");
    assert.ok(Array.isArray(resp.result.tools), "tools 应为数组");
    const names = resp.result.tools.map((tool) => tool.name);
    assert.ok(
      names.includes("search_and_download_images"),
      `tools 列表应包含 search_and_download_images，实际为: ${names.join(", ")}`
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
