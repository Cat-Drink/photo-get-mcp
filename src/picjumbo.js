import { fileURLToPath } from 'node:url';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120';

const FORBIDDEN_SLUG_PATTERN = /^(promote-your-product|faq-and-terms|your-love|interviews|photo-redistribution|privacy-policy|free-images|premium-membership|about-us|blog|new-free-images|resources|advertise|contact|.*-terms|.*-policy|.*-license|.*-faq)$/i;
const FORBIDDEN_SLUG_PREFIX_PATTERN = /^(about-|tag-|category-|author-|page-|feed-|wp-|login-|register-|search-|submit-|sitemap|attachment-)/i;

const EXCLUDE_IMG_PATTERN = /(picjumbo_logo|istock-logo|logo_premium|premium|gold\.png)/i;

async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      });
      if (!r.ok && r.status !== 200) {
        // some non-2xx still return useful HTML; try anyway
      }
      const text = await r.text();
      if (text && text.length > 0) return text;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  throw lastErr || new Error(`Fetch failed: ${url}`);
}

function decodeHtmlEntities(str) {
  return str.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function extractDetailUrls(html) {
  const urls = [];
  const seenSlugs = new Set();
  const re = /href\s*=\s*["'](https?:\/\/web\.archive\.org[^"']*picjumbo\.com\/([^\/?#"']+)\/?)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const slug = m[2];
    if (!slug) continue;
    const hyphenCount = (slug.match(/-/g) || []).length;
    if (hyphenCount < 2) continue;
    if (FORBIDDEN_SLUG_PATTERN.test(slug)) continue;
    if (FORBIDDEN_SLUG_PREFIX_PATTERN.test(slug)) continue;
    if (!/[a-z]{4,}/i.test(slug)) continue;
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    urls.push(url);
  }
  return urls;
}

function pickBestImageUrl(urls) {
  // Order by preference: no query string (original) > with query string > anything
  const preferred = urls.filter((u) => !/\?/u.test(u));
  if (preferred.length) return preferred[0];
  return urls[0];
}

function pickImageUrlsForHit(urls) {
  const original = urls.find((u) => !/\?(w|resize|quality|strip)/iu.test(u));
  const withQuery = urls.find((u) => /\?(w|resize|quality)/iu.test(u));
  return {
    largeImageURL: original || urls[0],
    webformatURL: withQuery || urls[Math.floor(urls.length / 2)] || urls[0],
    previewURL: withQuery || urls[0],
  };
}

async function parseDetailPage(detailUrl, keyword) {
  try {
    const html = await fetchWithRetry(detailUrl);
    // Collect picjumbo.com/wp-content image URLs
    const imgSet = new Set();
    const re = /["'](https:\/\/[^"']*picjumbo\.com[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      let u = m[1];
      u = u.replace(/&amp;/g, '&');
      if (EXCLUDE_IMG_PATTERN.test(u)) continue;
      if (!/picjumbo\.com\/wp-content\//i.test(u)) continue;
      if (/\?(w|resize|quality|strip)=\d{1,3}\b/i.test(u) && !/\?(w|resize|quality|strip)=\d{4,}/i.test(u)) {
        const sizeMatch = u.match(/[?&](?:w|resize)=(\d+)/i);
        if (sizeMatch && parseInt(sizeMatch[1], 10) < 400) continue;
      }
      imgSet.add(u);
    }
    const urls = [...imgSet];
    if (!urls.length) return null;
    const largeEnough = urls.filter(u => !/\?(w|resize|quality|strip)=\d{1,3}\b/i.test(u) || /[?&](?:w|resize)=(\d{4,})/i.test(u));
    if (largeEnough.length < 1) return null;

    const { largeImageURL, webformatURL, previewURL } = pickImageUrlsForHit(urls);

    let title = keyword;
    const titleMatch = html.match(/<title>([^<]*)</i);
    if (titleMatch) {
      title = decodeHtmlEntities(titleMatch[1].replace(/\s*\|\s*picjumbo.*$/i, '').replace(/\s*\|\s*Free.*$/i, '').trim());
    }

    let tags = '';
    const keywordMeta = html.match(/<meta\s+name=["'](?:keywords|news_keywords)["']\s+content=["']([^"']*)["']/i);
    if (keywordMeta) tags = decodeHtmlEntities(keywordMeta[1].trim());
    if (!tags) tags = `${title}, ${keyword}`;

    // ID: download?image=XXXX
    let id;
    const idMatch = html.match(/download\?image=(\d+)/i);
    if (idMatch) id = idMatch[1];
    else {
      const slugMatch = detailUrl.match(/picjumbo\.com\/([^\/?#]+)/i);
      id = slugMatch ? slugMatch[1] : `picjumbo-${Math.abs(hashStr(detailUrl))}`;
    }

    return {
      id: String(id),
      source: 'picjumbo',
      user: 'picjumbo',
      tags,
      previewURL,
      webformatURL,
      largeImageURL,
      imageWidth: 0,
      imageHeight: 0,
      pageURL: detailUrl,
    };
  } catch (err) {
    return null;
  }
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

export async function searchImages({ keyword, count = 10, maxPages = 100 }) {
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
    return [];
  }
  const encodedKeyword = encodeURIComponent(keyword.trim());
  const wantCount = typeof count === 'number' && count > 0 ? Math.floor(count) : Number.POSITIVE_INFINITY;

  const hits = [];
  const seenIds = new Set();

  for (let page = 1; page <= maxPages; page++) {
    if (hits.length >= wantCount) break;

    const searchUrl = page === 1
      ? `https://web.archive.org/web/2024/https://picjumbo.com/search/${encodedKeyword}/`
      : `https://web.archive.org/web/2024/https://picjumbo.com/search/${encodedKeyword}/page/${page}/`;

    let searchHtml;
    try {
      searchHtml = await fetchWithRetry(searchUrl);
    } catch (err) {
      break;
    }

    const detailUrls = extractDetailUrls(searchHtml);
    if (!detailUrls.length) break;

    // Check if this page repeats earlier results - if we already saw all, stop paging
    const remaining = detailUrls.filter((u) => {
      const slugMatch = u.match(/picjumbo\.com\/([^\/?#]+)/i);
      return slugMatch && !seenIds.has(slugMatch[1]);
    });
    if (!remaining.length) break;

    // Process detail pages (simple sequential to avoid hammering wayback)
    const fetchBatch = remaining.slice(0, Math.max(1, wantCount - hits.length));
    for (const du of fetchBatch) {
      const slugMatch = du.match(/picjumbo\.com\/([^\/?#]+)/i);
      if (slugMatch) seenIds.add(slugMatch[1]);
      const hit = await parseDetailPage(du, keyword);
      if (hit && hit.id && !seenIds.has(`hit-${hit.id}`)) {
        seenIds.add(`hit-${hit.id}`);
        hits.push(hit);
        if (hits.length >= wantCount) break;
      }
    }
  }
  return hits;
}

// CLI support: node src/picjumbo.js nature 3
const __filename = fileURLToPath(import.meta.url);
const mainFilename = process.argv[1];
if (mainFilename && path.resolve(mainFilename) === path.resolve(__filename)) {
  const keyword = process.argv[2] || 'nature';
  const count = parseInt(process.argv[3] || '5', 10);
  searchImages({ keyword, count }).then((hits) => {
    console.log(`[picjumbo] Got ${hits.length} hits for keyword="${keyword}"`);
    hits.slice(0, 5).forEach((h) => {
      console.log(` - #${h.id} by ${h.user}: ${h.tags}`);
    });
  }).catch((err) => {
    console.error('[picjumbo] error:', err);
    process.exit(1);
  });
}
