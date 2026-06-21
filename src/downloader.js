import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function slugify(str) {
  if (typeof str !== "string" || str.length === 0) {
    return "";
  }
  const allowed = /[^a-zA-Z0-9\u4e00-\u9fa5-]/g;
  let result = str.replace(allowed, "-");
  result = result.replace(/-+/g, "-");
  result = result.replace(/^-+|-+$/g, "");
  result = result.toLowerCase();
  return result;
}

export function buildFileName(hit) {
  const tags = (hit && hit.tags) || "";
  const firstTag = tags.split(",")[0].trim() || "image";
  const url = (hit && hit.webformatURL) || "";
  let ext = ".jpg";
  const dotIdx = url.lastIndexOf(".");
  if (dotIdx !== -1) {
    const candidate = url.slice(dotIdx);
    if (/^\.[a-zA-Z0-9]{1,6}$/.test(candidate)) {
      ext = candidate.toLowerCase();
    }
  }
  const id = (hit && hit.id) || "unknown";
  return `${id}-${slugify(firstTag)}${ext}`;
}

export function pickUrl(hit, size) {
  if (!hit) return "";
  if (size === "preview" && hit.previewURL) {
    return hit.previewURL;
  }
  if (size === "large" && hit.largeImageURL) {
    return hit.largeImageURL;
  }
  if (hit.webformatURL) {
    return hit.webformatURL;
  }
  if (hit.largeImageURL) {
    return hit.largeImageURL;
  }
  if (hit.previewURL) {
    return hit.previewURL;
  }
  return "";
}

export async function downloadImage(url, destPath, { retries = 2, timeout = 30000 } = {}) {
  const attempts = retries + 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      const tempPath = destPath + ".part";
      fs.writeFileSync(tempPath, Buffer.from(buffer));
      fs.renameSync(tempPath, destPath);
      const stats = fs.statSync(destPath);
      if (stats.size <= 0) {
        throw new Error("Downloaded file is empty");
      }
      return destPath;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        continue;
      }
      break;
    }
  }
  throw lastError;
}

export async function concurrentDownloadBatch(hits, dir, { concurrency = 5, size = "webformat" } = {}) {
  ensureDir(dir);
  const downloaded = [];
  const failed = [];
  const total = hits.length;
  for (let i = 0; i < total; i += concurrency) {
    const batch = hits.slice(i, i + concurrency);
    const batchPromises = batch.map(async (hit) => {
      try {
        const url = pickUrl(hit, size);
        if (!url) {
          failed.push({
            id: hit && hit.id,
            source: hit && hit.source,
            url: "",
            reason: "No URL available",
          });
          return;
        }
        const localPath = path.join(dir, buildFileName(hit));
        await downloadImage(url, localPath);
        downloaded.push({
          local_path: localPath,
          original_url: url,
          author: hit.user,
          tags: hit.tags,
          width: hit.imageWidth,
          height: hit.imageHeight,
          id: hit.id,
          source: hit.source || "pixabay",
          pixabay_id: hit.id, // 向后兼容：旧测试检查 pixabay_id
        });
      } catch (err) {
        failed.push({
          id: hit && hit.id,
          source: hit && hit.source,
          url: pickUrl(hit, size),
          reason: err.message || String(err),
        });
      }
    });
    await Promise.all(batchPromises);
  }
  return { downloaded, failed };
}

const __filename = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
  (async () => {
    try {
      const testDir = ensureDir("tmp/downloader-test");
      const testUrl = "https://cdn.pixabay.com/photo/2022/08/08/19/36/landscape-7373484_640.jpg";
      const testPath = path.join(testDir, "test.jpg");
      await downloadImage(testUrl, testPath);
      const size = fs.statSync(testPath).size;
      if (size > 10000) {
        console.log(`[downloader] SUCCESS: ${testPath} (${size} bytes)`);
        process.exit(0);
      } else {
        console.error(`[downloader] FAIL: file too small (${size} bytes)`);
        process.exit(1);
      }
    } catch (err) {
      console.error("[downloader] FAIL:", err.message || err);
      process.exit(1);
    }
  })();
}
