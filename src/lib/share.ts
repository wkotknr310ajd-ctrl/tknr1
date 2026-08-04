import type { BusinessCard } from "../types";

function line(label: string, value: string): string | null {
  return value.trim() ? `${label}: ${value.trim()}` : null;
}

/** Builds a plain-text summary of a card, suitable for sharing/copying. */
export function cardToShareText(card: BusinessCard): string {
  const lines = [
    card.name || "(名前未入力)",
    line("会社", card.company),
    line("役職", card.title),
    line("電話", card.phone),
    line("FAX", card.fax),
    line("メール", card.email),
    line("住所", card.address),
    line("Web", card.website),
    line("メモ", card.note)
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

/** Opens LINE with the given text pre-filled in the share/send dialog. */
export function shareViaLine(text: string) {
  const url = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function canUseWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function shareViaWebShare(title: string, text: string): Promise<void> {
  if (!canUseWebShare()) throw new Error("この端末では共有機能が利用できません");
  await navigator.share({ title, text });
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
