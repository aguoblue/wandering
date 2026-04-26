const noteUrl = "https://www.xiaohongshu.com/explore/69ca1948000000001a021524?xsec_token=ABJesEx7bNHERURPGlwSH4Fq_h0ifqiRcZGOU8vd4LOOM=&xsec_source=pc_search&source=web_explore_feed";

if (!noteUrl) {
  console.error("Please set noteUrl at the top of this file first.");
  process.exit(1);
}

const response = await fetch(noteUrl, {
  redirect: "follow",
  headers: {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
  },
});

const html = await response.text();
const result = {
  inputUrl: noteUrl,
  finalUrl: response.url,
  status: response.status,
  ok: response.ok,
  title: pickFirst([
    getMeta(html, "property", "og:title"),
    getMeta(html, "name", "twitter:title"),
    getTitle(html),
  ]),
  description: pickFirst([
    getMeta(html, "name", "description"),
    getMeta(html, "property", "og:description"),
    getMeta(html, "name", "twitter:description"),
  ]),
  keywords: getMeta(html, "name", "keywords"),
  jsonLd: getJsonLd(html),
  embeddedTextHints: getEmbeddedTextHints(html),
};

console.log(JSON.stringify(result, null, 2));

function pickFirst(values) {
  return values.map(cleanText).find(Boolean) || "";
}

function getTitle(htmlText) {
  const match = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]) : "";
}

function getMeta(htmlText, key, value) {
  const metas = htmlText.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    if (getAttr(tag, key)?.toLowerCase() === value.toLowerCase()) {
      return decodeHtml(getAttr(tag, "content") || "");
    }
  }
  return "";
}

function getJsonLd(htmlText) {
  const blocks = [];
  const pattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of htmlText.matchAll(pattern)) {
    const raw = decodeHtml(match[1].trim());
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      blocks.push({ parseError: true, raw: cleanText(raw).slice(0, 1000) });
    }
  }
  return blocks;
}

function getEmbeddedTextHints(htmlText) {
  const hints = [];
  const patterns = [
    /"title"\s*:\s*"((?:\\.|[^"\\]){2,300})"/g,
    /"desc"\s*:\s*"((?:\\.|[^"\\]){2,1000})"/g,
    /"description"\s*:\s*"((?:\\.|[^"\\]){2,1000})"/g,
    /"content"\s*:\s*"((?:\\.|[^"\\]){2,1000})"/g,
  ];

  for (const pattern of patterns) {
    for (const match of htmlText.matchAll(pattern)) {
      const text = cleanText(unescapeJsonString(match[1]));
      if (text && !hints.includes(text)) hints.push(text);
      if (hints.length >= 20) return hints;
    }
  }

  return hints;
}

function getAttr(tag, name) {
  const pattern = new RegExp(
    `${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`,
    "i",
  );
  const match = tag.match(pattern);
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function unescapeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
