import { useState, type FormEvent, type ReactNode } from "react";

const HASH_KEY = "morning-call-password-hash-v1";
const MIN_LENGTH = 4;

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [storedHash, setStoredHash] = useState<string | null>(() => localStorage.getItem(HASH_KEY));
  const [unlocked, setUnlocked] = useState(false);
  const [changing, setChanging] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const resetFields = () => {
    setPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
    setError("");
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_LENGTH) {
      setError(`パスワードは${MIN_LENGTH}文字以上で設定してください。`);
      return;
    }
    if (password !== confirmPassword) {
      setError("2つのパスワードが一致しません。");
      return;
    }
    setBusy(true);
    const hash = await sha256Hex(password);
    localStorage.setItem(HASH_KEY, hash);
    setStoredHash(hash);
    setUnlocked(true);
    setBusy(false);
    resetFields();
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const hash = await sha256Hex(password);
    setBusy(false);
    if (hash === storedHash) {
      setUnlocked(true);
      resetFields();
    } else {
      setError("パスワードが違います。");
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    const currentHash = await sha256Hex(currentPassword);
    if (currentHash !== storedHash) {
      setError("現在のパスワードが違います。");
      return;
    }
    if (password.length < MIN_LENGTH) {
      setError(`新しいパスワードは${MIN_LENGTH}文字以上で設定してください。`);
      return;
    }
    if (password !== confirmPassword) {
      setError("2つのパスワードが一致しません。");
      return;
    }
    const newHash = await sha256Hex(password);
    localStorage.setItem(HASH_KEY, newHash);
    setStoredHash(newHash);
    setChanging(false);
    resetFields();
  };

  if (unlocked && !changing) {
    return (
      <>
        {children}
        <div className="lock-bar">
          <button type="button" onClick={() => setChanging(true)}>
            パスワードを変更
          </button>
          <button type="button" onClick={() => setUnlocked(false)}>
            🔒 ロックする
          </button>
        </div>
      </>
    );
  }

  if (unlocked && changing) {
    return (
      <div className="password-gate">
        <form className="password-card" onSubmit={handleChangePassword}>
          <h2>パスワードを変更</h2>
          <label>
            現在のパスワード
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            新しいパスワード
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            新しいパスワード(確認)
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>
          {error && <p className="password-error">{error}</p>}
          <div className="password-actions">
            <button type="submit" className="primary">
              変更する
            </button>
            <button
              type="button"
              onClick={() => {
                setChanging(false);
                resetFields();
              }}
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (storedHash === null) {
    return (
      <div className="password-gate">
        <form className="password-card" onSubmit={handleCreate}>
          <h2>🔒 パスワードを設定してください</h2>
          <p className="muted">
            この端末で初めて使うときに、この端末専用のパスワードを決めます。次回からは、このアプリを開くたびに
            このパスワードの入力が必要になります。
          </p>
          <label>
            パスワード({MIN_LENGTH}文字以上)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            パスワード(確認)
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>
          {error && <p className="password-error">{error}</p>}
          <button type="submit" className="primary" disabled={busy}>
            設定する
          </button>
          <p className="muted password-note">
            ※ このパスワードはこの端末(このブラウザ)だけで使われ、他の端末とは共有されません。他の端末では、
            それぞれ別々にパスワードを設定できます。
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="password-gate">
      <form className="password-card" onSubmit={handleUnlock}>
        <h2>🔒 パスワードを入力してください</h2>
        <label>
          パスワード
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <p className="password-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          ロック解除
        </button>
        <p className="muted password-note">
          ※ パスワードを忘れた場合は、ブラウザの設定からこのサイトのデータを削除してください(設定内容もすべて
          リセットされます)。
        </p>
      </form>
    </div>
  );
}
