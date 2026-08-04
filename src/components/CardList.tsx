import type { CardSummary } from "../types";

interface Props {
  summaries: CardSummary[];
  loading: boolean;
  signedIn: boolean;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function CardList({ summaries, loading, signedIn, onOpen, onRefresh }: Props) {
  if (!signedIn) {
    return (
      <div className="empty-state">
        <p>Googleでサインインすると、ドライブに保存した名刺の一覧が表示されます。</p>
      </div>
    );
  }

  return (
    <div className="card-list-wrap">
      <div className="card-list-toolbar">
        <button onClick={onRefresh} disabled={loading}>
          {loading ? "更新中…" : "🔄 更新"}
        </button>
      </div>
      {loading && summaries.length === 0 ? (
        <p className="muted">読み込み中…</p>
      ) : summaries.length === 0 ? (
        <div className="empty-state">
          <p>まだ名刺が保存されていません。「+ 名刺を読み取る」から追加しましょう。</p>
        </div>
      ) : (
        <ul className="card-list">
          {summaries.map((c) => (
            <li key={c.id} className="card-list-item" onClick={() => onOpen(c.id)}>
              <div className="card-list-avatar">{c.name ? c.name.charAt(0) : "?"}</div>
              <div className="card-list-info">
                <div className="card-list-name">{c.name || "(無題)"}</div>
                <div className="card-list-company">{c.company !== "-" ? c.company : ""}</div>
              </div>
              <div className="card-list-date">{formatDate(c.createdAt)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
