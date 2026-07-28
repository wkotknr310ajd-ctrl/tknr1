function formatRequirement(req) {
  const typeLabel = { boolean: "○×要件", numeric: "数値要件", choice: "選択要件" }[req.type] || req.type;
  return `  ・(${typeLabel}) ${req.text}`;
}

function formatItem(match, index) {
  const { item, serviceName, type } = match;
  const kindLabel = type === "reduction" ? "減算" : "加算";
  const lines = [
    `${index + 1}. 【${serviceName}】${item.name}(${kindLabel} / ${item.category})`,
    item.summary,
    "",
    "算定要件:",
    ...(item.requirements || []).map(formatRequirement),
  ];
  if (item.judgmentLogic) lines.push("", `判定の考え方: ${item.judgmentLogic}`);
  if (item.units) lines.push(`単位数の目安: ${item.units}`);
  if (item.notes) lines.push("", `補足: ${item.notes}`);
  if (item.commonPitfalls && item.commonPitfalls.length) {
    lines.push("", "よくある指摘・誤り:", ...item.commonPitfalls.map((p) => `  ・${p}`));
  }
  if (item.verifyAgainst) lines.push("", `要確認先: ${item.verifyAgainst}`);
  return lines.join("\n");
}

function formatSourceExcerpts(sourceExcerpts) {
  if (!sourceExcerpts || !sourceExcerpts.length) return "";
  const lines = sourceExcerpts.map((s, i) => {
    const trimmed = s.chunk.length > 500 ? `${s.chunk.slice(0, 500)}…` : s.chunk;
    return `[出典: ${s.file}]\n${trimmed}`;
  });
  return ["", "--- 関連する原文資料の抜粋 ---", "", lines.join("\n\n")].join("\n");
}

/**
 * Builds a deterministic, templated answer directly from matched KB entries.
 * Used when no LLM key is configured, and as a safety fallback if the LLM call fails.
 */
function formatFallbackAnswer(question, matches, sourceExcerpts = []) {
  if (!matches.length && !sourceExcerpts.length) {
    return [
      `「${question}」に一致する加算・減算情報が見つかりませんでした。`,
      "サービス種類(施設入所支援・生活介護・短期入所・共同生活援助)や加算名を含めて質問し直してみてください。",
      "例:「生活介護の人員配置体制加算の要件は?」「共同生活援助の夜間支援等体制加算とは?」",
    ].join("\n");
  }

  const header = matches.length
    ? `「${question}」に関連する可能性が高い加算・減算を${matches.length}件見つけました。`
    : `「${question}」に一致する整理済みの加算情報はありませんが、原文資料の中に関連する記述が見つかりました。`;
  const body = matches.map(formatItem).join("\n\n---\n\n");
  const footer = [
    "",
    "※ 本回答は一般的な制度知識と、取り込んだ厚生労働省の報酬改定資料・Q&A原文に基づく参考情報です。単位数や適用の可否は事業所の実際の体制・利用者の状態・自治体の運用により異なる場合があります。",
    "実際の請求(国保連への伝送)にあたっては、必ず最新の報酬告示・留意事項通知・Q&A、及び管轄自治体への確認を行ってください。",
  ].join("\n");

  return [header, "", body, formatSourceExcerpts(sourceExcerpts), footer].join("\n");
}

module.exports = { formatFallbackAnswer };
