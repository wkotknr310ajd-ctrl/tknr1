const express = require("express");
const { getServiceList, getService, getAllReductionsFlat } = require("../lib/dataStore");
const { search, detectServiceIds } = require("../lib/search");
const { evaluate } = require("../lib/eligibility");
const claude = require("../lib/claude");
const { formatFallbackAnswer } = require("../lib/answerFormatter");
const { searchSourceArchive } = require("../lib/sourceArchive");

const router = express.Router();

router.get("/services", (req, res) => {
  res.json({ services: getServiceList() });
});

router.get("/services/:serviceId", (req, res) => {
  const svc = getService(req.params.serviceId);
  if (!svc) return res.status(404).json({ error: "service not found" });
  res.json(svc);
});

router.get("/reductions", (req, res) => {
  res.json({ reductions: getAllReductionsFlat() });
});

router.get("/search", (req, res) => {
  const q = (req.query.q || "").toString();
  if (!q.trim()) return res.status(400).json({ error: "query parameter q is required" });
  const serviceIds = req.query.serviceId ? [req.query.serviceId.toString()] : null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const results = search(q, { serviceIds, limit });
  res.json({ query: q, results });
});

router.get("/source-search", (req, res) => {
  const q = (req.query.q || "").toString();
  if (!q.trim()) return res.status(400).json({ error: "query parameter q is required" });
  const limit = Math.min(parseInt(req.query.limit, 10) || 3, 10);
  const results = searchSourceArchive(q, { limit });
  res.json({ query: q, results });
});

router.post("/chat", async (req, res) => {
  const message = (req.body && req.body.message ? String(req.body.message) : "").trim();
  if (!message) return res.status(400).json({ error: "message is required" });

  // If the message text names a specific service, trust that over the UI's scope
  // selector - a stale scope selection shouldn't override an explicit question.
  const requestedServiceId = req.body.serviceId ? String(req.body.serviceId) : null;
  const mentionedServiceIds = detectServiceIds(message);
  let serviceIds = null;
  if (mentionedServiceIds.length) {
    serviceIds = mentionedServiceIds;
  } else if (requestedServiceId) {
    serviceIds = [requestedServiceId];
  }
  const matches = search(message, { serviceIds, limit: 4 });
  const sourceExcerpts = searchSourceArchive(message, { limit: 3 });

  let answer;
  let source = "kb-template";
  try {
    const llmAnswer = await claude.generateGroundedAnswer(message, matches, sourceExcerpts);
    if (llmAnswer) {
      answer = llmAnswer;
      source = "llm-grounded";
    }
  } catch (err) {
    console.error("LLM generation failed, falling back to template:", err.message);
  }

  if (!answer) {
    answer = formatFallbackAnswer(message, matches, sourceExcerpts);
  }

  res.json({
    answer,
    source,
    matches: matches.map((m) => ({
      serviceId: m.serviceId,
      serviceName: m.serviceName,
      type: m.type,
      id: m.item.id,
      name: m.item.name,
      score: Number(m.score.toFixed(3)),
    })),
    sourceExcerpts: sourceExcerpts.map((s) => ({ file: s.file, score: Number(s.score.toFixed(3)) })),
  });
});

router.post("/eligibility/:serviceId/:additionId", (req, res) => {
  const { serviceId, additionId } = req.params;
  const answers = req.body && req.body.answers ? req.body.answers : {};
  const result = evaluate(serviceId, additionId, answers);
  if (!result.found) return res.status(404).json(result);
  res.json(result);
});

module.exports = router;
