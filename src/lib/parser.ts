import type { BusinessCard } from "../types";

export type ParsedFields = Pick<
  BusinessCard,
  "name" | "company" | "title" | "phone" | "fax" | "email" | "address" | "website"
>;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+\.[A-Za-z]{2,}[^\s]*)/i;
const FAX_RE = /(?:FAX|Fax|fax|ＦＡＸ)[:：\s]*([0-9\-()+ ０-９－]{8,})/;
const TEL_RE = /(?:TEL|Tel|tel|℡|電話|ＴＥＬ)[:：\s]*([0-9\-()+ ０-９－]{8,})/;
const BARE_PHONE_RE = /0[0-9０-９]{1,4}[-－][0-9０-９]{1,4}[-－][0-9０-９]{3,4}/;
const POSTAL_RE = /〒?\s*(\d{3}-?\d{4})/;

const COMPANY_KEYWORDS = ["株式会社", "有限会社", "合同会社", "合資会社", "Co\\.,?\\s*Ltd", "Inc\\.", "Corporation", "K\\.K\\."];
const TITLE_KEYWORDS = [
  "代表取締役",
  "取締役",
  "執行役員",
  "会長",
  "社長",
  "副社長",
  "専務",
  "常務",
  "部長",
  "次長",
  "課長",
  "係長",
  "主任",
  "マネージャー",
  "リーダー",
  "担当",
  "所長",
  "支店長",
  "室長",
  "CEO",
  "CTO",
  "COO",
  "CFO",
  "Manager",
  "Director",
  "President"
];

const NAME_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,4}[\s　][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,4}$/u;

function toHalfWidth(value: string): string {
  return value.replace(/[０-９－]/g, (ch) => {
    if (ch === "－") return "-";
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
}

function containsAny(line: string, keywords: string[]): boolean {
  return keywords.some((kw) => new RegExp(kw, "i").test(line));
}

/** Best-effort heuristic extraction of structured fields from raw OCR text.
 * Results are meant to be reviewed/corrected by the user before saving. */
export function parseCardText(rawText: string): ParsedFields {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: ParsedFields = {
    name: "",
    company: "",
    title: "",
    phone: "",
    fax: "",
    email: "",
    address: "",
    website: "",
  };

  const usedLines = new Set<number>();
  const fullText = lines.join(" ");

  const emailMatch = fullText.match(EMAIL_RE);
  if (emailMatch) result.email = emailMatch[0];

  const urlMatch = fullText.match(URL_RE);
  if (urlMatch && !urlMatch[0].includes("@")) result.website = urlMatch[0];

  lines.forEach((line, idx) => {
    const faxMatch = line.match(FAX_RE);
    if (faxMatch && !result.fax) {
      result.fax = toHalfWidth(faxMatch[1].trim());
      usedLines.add(idx);
      return;
    }
    const telMatch = line.match(TEL_RE);
    if (telMatch && !result.phone) {
      result.phone = toHalfWidth(telMatch[1].trim());
      usedLines.add(idx);
      return;
    }
    if (!result.phone) {
      const bareMatch = line.match(BARE_PHONE_RE);
      if (bareMatch) {
        result.phone = toHalfWidth(bareMatch[0]);
        usedLines.add(idx);
        return;
      }
    }
    if (line.includes(result.email) && result.email) usedLines.add(idx);
    if (line.includes(result.website) && result.website) usedLines.add(idx);
  });

  lines.forEach((line, idx) => {
    if (usedLines.has(idx)) return;
    if (!result.company && containsAny(line, COMPANY_KEYWORDS)) {
      result.company = line;
      usedLines.add(idx);
    }
  });

  lines.forEach((line, idx) => {
    if (usedLines.has(idx)) return;
    if (!result.title && containsAny(line, TITLE_KEYWORDS) && line.length <= 20) {
      result.title = line;
      usedLines.add(idx);
    }
  });

  lines.forEach((line, idx) => {
    if (usedLines.has(idx)) return;
    if (POSTAL_RE.test(line) || /(都|道|府|県).{0,15}(市|区|町|村)/.test(line)) {
      result.address = result.address ? `${result.address} ${line}` : line;
      usedLines.add(idx);
    }
  });

  lines.forEach((line, idx) => {
    if (usedLines.has(idx) || result.name) return;
    if (NAME_RE.test(line)) {
      result.name = line.replace(/　/g, " ");
      usedLines.add(idx);
    }
  });

  if (!result.name) {
    const fallback = lines.find((l, idx) => !usedLines.has(idx) && l.length >= 2 && l.length <= 12);
    if (fallback) result.name = fallback;
  }

  return result;
}
