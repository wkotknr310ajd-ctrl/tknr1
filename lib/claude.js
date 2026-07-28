const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

function isEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Generates a grounded natural-language answer from the matched knowledge-base
 * entries. Only called when ANTHROPIC_API_KEY is configured; otherwise the
 * caller falls back to a templated answer built directly from the KB entries.
 */
async function generateGroundedAnswer(question, matches, sourceExcerpts = []) {
  if (!isEnabled()) return null;

  const kbContext = matches
    .map((m, i) => {
      const item = m.item;
      const reqLines = (item.requirements || [])
        .map((r) => `    - [${r.type}] ${r.text}`)
        .join("\n");
      return [
        `### 資料${i + 1}: ${item.name}(${m.serviceName} / ${item.category})`,
        `概要: ${item.summary}`,
        `要件:\n${reqLines}`,
        `判定ロジック: ${item.judgmentLogic || "-"}`,
        `備考: ${item.notes || "-"}`,
        `要確認先: ${item.verifyAgainst || "-"}`,
      ].join("\n");
    })
    .join("\n\n");

  const archiveContext = sourceExcerpts
    .map((s, i) => `### 原文抜粋${i + 1}(出典: ${s.file})\n${s.chunk}`)
    .join("\n\n");

  const context = [kbContext, archiveContext].filter(Boolean).join("\n\n");

  const systemPrompt = [
    "あなたは日本の障害者総合支援法に基づく障害福祉サービス(施設入所支援・生活介護・短期入所・共同生活援助)の",
    "報酬・加算に詳しい専門アシスタントです。以下に与えられる資料の範囲内で、質問に対して要件・仕組み・注意点を",
    "具体的かつ正確に説明してください。",
    "資料には2種類あります: (1)社内ナレッジベースの抜粋(要約済み)、(2)厚生労働省の報酬改定資料・告示・Q&Aから",
    "抽出した原文抜粋(「原文抜粋」として提示、出典ファイル名付き)。原文抜粋に具体的な数値や条文がある場合は、",
    "ナレッジベースの記載より優先して採用し、回答中で「(出典: ファイル名)」の形式で出典を明記してください。",
    "資料に記載のない数値(正確な単位数など)を断定的に答えてはいけません。不明な場合は「要確認」と明記してください。",
    "回答の最後に、必ず「実際の算定にあたっては最新の報酬告示・留意事項通知・自治体の確認が必要です」という趣旨の一文を添えてください。",
  ].join("\n");

  const userPrompt = `質問: ${question}\n\n参考資料:\n${context}`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("\n");
  return text || null;
}

module.exports = { isEnabled, generateGroundedAnswer };
