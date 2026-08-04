// Thin wrapper around Google Identity Services (GIS) token client.
// Loaded via <script src="https://accounts.google.com/gsi/client"> in index.html.

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const STORAGE_KEY = "meishi.googleToken";

interface StoredToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => void;
          }): { requestAccessToken: (opts?: { prompt?: string }) => void };
          revoke: (token: string, done: () => void) => void;
        };
      };
    };
  }
}

let tokenClient: ReturnType<NonNullable<Window["google"]>["accounts"]["oauth2"]["initTokenClient"]> | null = null;
let pendingResolvers: Array<(token: string | null) => void> = [];

function readStoredToken(): StoredToken | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (parsed.expiresAt > Date.now() + 30_000) return parsed;
  } catch {
    // ignore malformed value
  }
  return null;
}

function storeToken(accessToken: string, expiresInSeconds: number) {
  const stored: StoredToken = {
    accessToken,
    expiresAt: Date.now() + expiresInSeconds * 1000
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  return id ?? "";
}

export function isConfigured(): boolean {
  return getClientId().length > 0;
}

function waitForGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else if (Date.now() - start > 10_000) {
        reject(new Error("Google Identity Services の読み込みに失敗しました"));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

async function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  await waitForGis();
  tokenClient = window.google!.accounts.oauth2.initTokenClient({
    client_id: getClientId(),
    scope: SCOPE,
    callback: (resp) => {
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      if (resp.error || !resp.access_token) {
        resolvers.forEach((r) => r(null));
        return;
      }
      storeToken(resp.access_token, resp.expires_in ?? 3600);
      resolvers.forEach((r) => r(resp.access_token!));
    }
  });
  return tokenClient;
}

/** Returns a cached, still-valid token without prompting the user. */
export function getCachedToken(): string | null {
  return readStoredToken()?.accessToken ?? null;
}

/**
 * Requests an access token, prompting the Google sign-in / consent UI when
 * necessary. Resolves to null if the user cancels or an error occurs.
 */
export async function requestAccessToken(interactive: boolean): Promise<string | null> {
  const cached = readStoredToken();
  if (cached) return cached.accessToken;

  const client = await ensureTokenClient();
  return new Promise((resolve) => {
    pendingResolvers.push(resolve);
    client.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

export function signOut() {
  const cached = readStoredToken();
  sessionStorage.removeItem(STORAGE_KEY);
  if (cached && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(cached.accessToken, () => {});
  }
}
