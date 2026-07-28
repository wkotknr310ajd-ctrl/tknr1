const fs = require("fs");
const path = require("path");

const ARCHIVE_DIR = path.join(__dirname, "..", "data", "source-archive");
const MIN_CHUNK_LEN = 30;

let index = null;

function bigrams(text) {
  const clean = text.replace(/\s+/g, "");
  const grams = new Set();
  for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2));
  return grams;
}

function scoreOverlap(queryGrams, targetGrams) {
  if (queryGrams.size === 0 || targetGrams.size === 0) return 0;
  let overlap = 0;
  for (const g of queryGrams) if (targetGrams.has(g)) overlap++;
  return overlap / queryGrams.size;
}

// Splits a source text file into paragraph-like chunks (blank-line separated),
// merging short lines so each chunk carries enough context to be useful as a citation.
function chunkText(raw) {
  const lines = raw.split("\n");
  const chunks = [];
  let buffer = [];
  for (const line of lines) {
    if (line.trim() === "" && buffer.length) {
      chunks.push(buffer.join("\n").trim());
      buffer = [];
    } else if (line.trim() !== "") {
      buffer.push(line);
    }
  }
  if (buffer.length) chunks.push(buffer.join("\n").trim());
  return chunks.filter((c) => c.length >= MIN_CHUNK_LEN);
}

function buildIndex() {
  if (index) return index;
  const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".txt"));
  const entries = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(ARCHIVE_DIR, file), "utf-8");
    for (const chunk of chunkText(raw)) {
      entries.push({ file, chunk, grams: bigrams(chunk) });
    }
  }
  index = entries;
  return index;
}

/**
 * Keyword-searches the raw source archive (official notices/Q&A extracted to text)
 * and returns the most relevant paragraph-level excerpts with their source filename,
 * so chat answers can cite the primary document instead of only the curated JSON.
 */
function searchSourceArchive(query, { limit = 3 } = {}) {
  const entries = buildIndex();
  const queryGrams = bigrams(query);
  const scored = entries
    .map((e) => ({ file: e.file, chunk: e.chunk, score: scoreOverlap(queryGrams, e.grams) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  // Avoid returning multiple near-duplicate chunks from the same file.
  const seenFiles = new Map();
  const results = [];
  for (const r of scored) {
    const countForFile = seenFiles.get(r.file) || 0;
    if (countForFile >= 2) continue;
    seenFiles.set(r.file, countForFile + 1);
    results.push(r);
    if (results.length >= limit) break;
  }
  return results;
}

module.exports = { searchSourceArchive };
