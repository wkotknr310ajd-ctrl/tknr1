export type Tab = "timer" | "morning";

interface HeaderProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export default function Header({ active, onChange }: HeaderProps) {
  return (
    <header className="app-header">
      <h1>🦑 エギングタイマー</h1>
      <nav className="tabs">
        <button
          type="button"
          className={active === "timer" ? "tab-btn active" : "tab-btn"}
          onClick={() => onChange("timer")}
        >
          ⏱ タイマー
        </button>
        <button
          type="button"
          className={active === "morning" ? "tab-btn active" : "tab-btn"}
          onClick={() => onChange("morning")}
        >
          ⏰ モーニングコール
        </button>
      </nav>
    </header>
  );
}
