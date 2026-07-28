const { getService, getServiceList } = require("./dataStore");

const SERVICE_ALIASES = {
  shisetsu_nyusho_shien: ["施設入所支援", "施設入所", "入所施設", "入所支援"],
  seikatsu_kaigo: ["生活介護", "デイサービス", "生活介護事業所"],
  tanki_nyusho: ["短期入所", "ショートステイ", "しょうと", "短期"],
  kyodo_seikatsu_engo: [
    "共同生活援助",
    "共同生活介護",
    "グループホーム",
    "ケアホーム",
    "GH",
    "gh",
  ],
};

function detectServiceIds(query) {
  const hits = [];
  for (const [serviceId, aliases] of Object.entries(SERVICE_ALIASES)) {
    if (aliases.some((alias) => query.includes(alias))) hits.push(serviceId);
  }
  return hits;
}

// Character bigram shingles - a cheap, dependency-free way to score
// Japanese text similarity without a morphological tokenizer.
function bigrams(text) {
  const clean = text.replace(/\s+/g, "");
  const grams = new Set();
  for (let i = 0; i < clean.length - 1; i++) {
    grams.add(clean.slice(i, i + 2));
  }
  return grams;
}

function scoreOverlap(queryGrams, targetGrams) {
  if (queryGrams.size === 0 || targetGrams.size === 0) return 0;
  let overlap = 0;
  for (const g of queryGrams) {
    if (targetGrams.has(g)) overlap++;
  }
  return overlap / queryGrams.size;
}

function buildSearchableText(item) {
  const parts = [
    item.name,
    item.category,
    item.summary,
    item.notes || "",
    ...(item.requirements || []).map((r) => r.text),
    ...(item.commonPitfalls || []),
  ];
  return parts.join(" 　 ");
}

/**
 * Ranks additions/reductions against a free-text query.
 * Returns top matches with a relevance score in [0, ~2].
 */
function search(query, { serviceIds = null, limit = 5, includeReductions = true } = {}) {
  const detectedServiceIds = serviceIds || detectServiceIds(query);
  const services = detectedServiceIds.length
    ? detectedServiceIds.map(getService).filter(Boolean)
    : getServiceList()
        .map((s) => getService(s.serviceId))
        .filter(Boolean);

  const queryGrams = bigrams(query);
  const results = [];

  for (const svc of services) {
    for (const item of svc.additions) {
      const text = buildSearchableText(item);
      let score = scoreOverlap(queryGrams, bigrams(text));
      if (query.includes(item.name) || item.name.includes(query)) score += 1;
      if (score > 0) {
        results.push({ type: "addition", serviceId: svc.serviceId, serviceName: svc.serviceName, item, score });
      }
    }
    if (includeReductions) {
      for (const item of svc.reductions) {
        const text = buildSearchableText(item);
        let score = scoreOverlap(queryGrams, bigrams(text));
        if (query.includes(item.name) || item.name.includes(query)) score += 1;
        if (score > 0) {
          results.push({ type: "reduction", serviceId: svc.serviceId, serviceName: svc.serviceName, item, score });
        }
      }
    }
  }

  // Deduplicate common items that appear once per service (keep the highest scoring instance,
  // but only when the user didn't ask about a specific service).
  const dedupMap = new Map();
  for (const r of results) {
    const key = r.item.scope === "common" && detectedServiceIds.length === 0 ? `common:${r.item.id}` : `${r.serviceId}:${r.item.id}`;
    const existing = dedupMap.get(key);
    if (!existing || existing.score < r.score) dedupMap.set(key, r);
  }

  return Array.from(dedupMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { search, detectServiceIds };
