type View = "list" | "capture";

interface Props {
  signedIn: boolean;
  authBusy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  view: View;
  onChangeView: (v: View) => void;
  configured: boolean;
}

export default function Header({ signedIn, authBusy, onSignIn, onSignOut, view, onChangeView, configured }: Props) {
  return (
    <header className="app-header">
      <h1>📇 名刺スキャナー</h1>
      <nav className="tabs">
        <button className={view === "list" ? "active" : ""} onClick={() => onChangeView("list")}>
          一覧
        </button>
        <button className={view === "capture" ? "active" : ""} onClick={() => onChangeView("capture")}>
          + 名刺を読み取る
        </button>
      </nav>
      <div className="auth-area">
        {!configured ? (
          <span className="muted">未設定</span>
        ) : signedIn ? (
          <button onClick={onSignOut}>サインアウト</button>
        ) : (
          <button disabled={authBusy} onClick={onSignIn}>
            {authBusy ? "サインイン中…" : "Googleでサインイン"}
          </button>
        )}
      </div>
    </header>
  );
}
