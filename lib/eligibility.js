const { findAdditionById } = require("./dataStore");

/**
 * Lightweight rule evaluator for a single addition's requirement checklist.
 * This is the first step toward the "auto-judgment" feature the roadmap
 * describes; it only evaluates boolean requirements deterministically.
 * Non-boolean requirements (numeric thresholds, multi-choice grades) are
 * returned as "needsReview" because the correct threshold varies by
 * official notice/grade and must be confirmed against source documents.
 */
function evaluate(serviceId, additionId, answers = {}) {
  const item = findAdditionById(serviceId, additionId);
  if (!item) {
    return { found: false, error: `addition not found: ${serviceId}/${additionId}` };
  }

  const requirementResults = (item.requirements || []).map((req) => {
    const answer = answers[req.id];
    if (req.type === "boolean") {
      if (typeof answer !== "boolean") {
        return { ...req, status: "unanswered" };
      }
      return { ...req, status: answer ? "met" : "not_met", answer };
    }
    // numeric / choice: we surface the raw answer but don't auto-judge pass/fail
    return { ...req, status: answer === undefined ? "unanswered" : "needs_review", answer };
  });

  const booleanResults = requirementResults.filter((r) => r.type === "boolean");
  const hasUnanswered = requirementResults.some((r) => r.status === "unanswered");
  const hasNeedsReview = requirementResults.some((r) => r.status === "needs_review");

  let verdict;
  if (hasUnanswered) {
    verdict = "incomplete";
  } else if (item.judgmentLogic && item.judgmentLogic.startsWith("OR")) {
    verdict = booleanResults.some((r) => r.status === "met") ? "likely_eligible" : "likely_not_eligible";
  } else {
    // default AND semantics
    verdict = booleanResults.every((r) => r.status === "met") ? "likely_eligible" : "likely_not_eligible";
  }
  if (hasNeedsReview && verdict === "likely_eligible") {
    verdict = "likely_eligible_needs_review";
  }

  return {
    found: true,
    serviceId,
    additionId,
    name: item.name,
    judgmentLogic: item.judgmentLogic,
    requirementResults,
    verdict,
    disclaimer:
      "この判定は入力内容と一般的な要件構造に基づく簡易チェックです。単位数の確定や最終的な算定可否は、必ず最新の報酬告示・留意事項通知・自治体への確認と併せて判断してください。",
  };
}

module.exports = { evaluate };
