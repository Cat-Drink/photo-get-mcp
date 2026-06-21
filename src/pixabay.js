import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_API_KEY = "13800043-6bef794c42f35880cbf2e101f";

export const getApiKey = () => process.env.PHOTO_GET_API_KEY || DEFAULT_API_KEY;

export class PixabayApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "PixabayApiError";
    this.statusCode = statusCode;
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

export async function searchImages({ keyword, count = 10, safesearch = true, apiKey }) {
  const key = apiKey || getApiKey();
  if (!keyword) {
    return [];
  }

  const encodedKeyword = encodeURIComponent(keyword);
  const maxPerPage = 200;
  const maxTotal = 500;
  const target = Math.min(count, maxTotal);
  const safe = safesearch ? "true" : "false";

  const hits = [];
  let page = 1;

  while (hits.length < target) {
    const remaining = target - hits.length;
    const perPage = Math.min(remaining, maxPerPage);
    const url = `https://pixabay.com/api/?key=${key}&q=${encodedKeyword}&image_type=photo&per_page=${perPage}&page=${page}&safesearch=${safe}`;

    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new NetworkError(err.message || "Network request failed");
    }

    if (response.status !== 200) {
      const text = await response.text().catch(() => "");
      throw new PixabayApiError(`Pixabay API returned status ${response.status}: ${text}`, response.status);
    }

    const data = await response.json();
    const pageHits = data.hits || [];

    if (pageHits.length === 0) {
      break;
    }

    for (const hit of pageHits) {
      if (hits.length >= target) break;
      hits.push({ ...hit, source: 'pixabay' });
    }

    if (hits.length >= maxTotal) break;
    if (pageHits.length < perPage) break;

    page += 1;
    if (page > Math.ceil(maxTotal / maxPerPage)) break;
  }

  return hits;
}

const __filename = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const keyword = process.argv[2] || "nature";
  const count = parseInt(process.argv[3] || "3", 10);
  searchImages({ keyword, count }).then(hits => {
    console.log(`[pixabay] Got ${hits.length} hits for keyword="${keyword}"`);
    hits.slice(0, 2).forEach(h => console.log(` - #${h.id} by ${h.user}: ${h.tags}`));
    process.exit(0);
  }).catch(err => {
    console.error(`[pixabay] Error:`, err.message);
    process.exit(1);
  });
}
