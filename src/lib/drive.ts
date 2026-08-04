import type { BusinessCard, CardSummary } from "../types";

const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_NAME = "名刺スキャナー";
const FOLDER_ID_CACHE_KEY = "meishi.driveFolderId";
const NAME_PREFIX = "meishi";
const NAME_SEP = "__";

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API error ${res.status}: ${body}`);
  }
  return res;
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[\\/\r\n]/g, " ").replace(NAME_SEP, "_").trim().slice(0, 60);
}

function buildFileName(card: Pick<BusinessCard, "name" | "company" | "createdAt">): string {
  const safeName = sanitizeForFilename(card.name || "無題");
  const safeCompany = sanitizeForFilename(card.company || "-");
  return `${NAME_PREFIX}${NAME_SEP}${card.createdAt}${NAME_SEP}${safeName}${NAME_SEP}${safeCompany}.json`;
}

function parseFileName(fileId: string, fileName: string): CardSummary | null {
  if (!fileName.startsWith(`${NAME_PREFIX}${NAME_SEP}`)) return null;
  const withoutExt = fileName.replace(/\.json$/, "");
  const parts = withoutExt.split(NAME_SEP);
  if (parts.length < 4) return null;
  const [, createdAt, name, company] = parts;
  return { id: fileId, createdAt, name, company };
}

/** Finds (or creates) the app's dedicated folder in the user's Drive. */
export async function getOrCreateFolder(token: string): Promise<string> {
  const cached = localStorage.getItem(FOLDER_ID_CACHE_KEY);
  if (cached) {
    try {
      await driveFetch(token, `${API_BASE}/files/${cached}?fields=id,trashed`);
      return cached;
    } catch {
      localStorage.removeItem(FOLDER_ID_CACHE_KEY);
    }
  }

  const query = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const listRes = await driveFetch(token, `${API_BASE}/files?q=${query}&fields=files(id,name)`);
  const listJson = (await listRes.json()) as { files: Array<{ id: string }> };
  if (listJson.files.length > 0) {
    localStorage.setItem(FOLDER_ID_CACHE_KEY, listJson.files[0].id);
    return listJson.files[0].id;
  }

  const createRes = await driveFetch(token, `${API_BASE}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  const createJson = (await createRes.json()) as { id: string };
  localStorage.setItem(FOLDER_ID_CACHE_KEY, createJson.id);
  return createJson.id;
}

/** Lists card summaries by reading filenames only (no per-file downloads). */
export async function listCardSummaries(token: string, folderId: string): Promise<CardSummary[]> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/json'`);
  const res = await driveFetch(
    token,
    `${API_BASE}/files?q=${query}&fields=files(id,name)&orderBy=name desc&pageSize=1000`
  );
  const json = (await res.json()) as { files: Array<{ id: string; name: string }> };
  return json.files
    .map((f) => parseFileName(f.id, f.name))
    .filter((c): c is CardSummary => c !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function fetchCard(token: string, fileId: string): Promise<BusinessCard> {
  const res = await driveFetch(token, `${API_BASE}/files/${fileId}?alt=media`);
  return (await res.json()) as BusinessCard;
}

function buildMultipartBody(metadata: unknown, contentJson: string, boundary: string): string {
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  return (
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    contentJson +
    closeDelimiter
  );
}

/** Creates a new card file in Drive and returns its file id. */
export async function createCard(token: string, folderId: string, card: BusinessCard): Promise<string> {
  const boundary = `meishi_boundary_${crypto.randomUUID()}`;
  const metadata = { name: buildFileName(card), parents: [folderId], mimeType: "application/json" };
  const body = buildMultipartBody(metadata, JSON.stringify(card), boundary);
  const res = await driveFetch(token, `${UPLOAD_BASE}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** Overwrites an existing card file's metadata + content. */
export async function updateCard(token: string, fileId: string, card: BusinessCard): Promise<void> {
  const boundary = `meishi_boundary_${crypto.randomUUID()}`;
  const metadata = { name: buildFileName(card) };
  const body = buildMultipartBody(metadata, JSON.stringify(card), boundary);
  await driveFetch(token, `${UPLOAD_BASE}/files/${fileId}?uploadType=multipart&fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
}

export async function deleteCard(token: string, fileId: string): Promise<void> {
  await driveFetch(token, `${API_BASE}/files/${fileId}`, { method: "DELETE" });
}
