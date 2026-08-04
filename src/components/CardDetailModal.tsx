import { useEffect, useState } from "react";
import type { BusinessCard } from "../types";
import CardForm, { type FormFields } from "./CardForm";
import { canUseWebShare, cardToShareText, copyTextToClipboard, shareViaLine, shareViaWebShare } from "../lib/share";

interface Props {
  card: BusinessCard | null;
  loading: boolean;
  onClose: () => void;
  onUpdate: (card: BusinessCard) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function CardDetailModal({ card, loading, onClose, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<FormFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setEditing(false);
    setConfirmingDelete(false);
    setError(null);
    if (card) {
      const { name, company, title, phone, fax, email, address, website, note } = card;
      setFields({ name, company, title, phone, fax, email, address, website, note });
    }
  }, [card]);

  if (!loading && !card) return null;

  const handleSaveEdit = async () => {
    if (!card || !fields) return;
    setBusy(true);
    setError(null);
    try {
      await onUpdate({ ...card, ...fields, updatedAt: new Date().toISOString() });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(card.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!card) return;
    await copyTextToClipboard(cardToShareText(card));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        {loading || !card || !fields ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <>
            {card.imageDataUrl && <img className="card-photo" src={card.imageDataUrl} alt={card.name} />}
            {error && <div className="banner banner-error">{error}</div>}

            {editing ? (
              <CardForm value={fields} onChange={(patch) => setFields((f) => (f ? { ...f, ...patch } : f))} disabled={busy} />
            ) : (
              <dl className="card-detail-fields">
                <dt>氏名</dt>
                <dd>{card.name || "-"}</dd>
                <dt>会社名</dt>
                <dd>{card.company || "-"}</dd>
                <dt>役職</dt>
                <dd>{card.title || "-"}</dd>
                <dt>電話番号</dt>
                <dd>{card.phone || "-"}</dd>
                <dt>FAX</dt>
                <dd>{card.fax || "-"}</dd>
                <dt>メール</dt>
                <dd>{card.email || "-"}</dd>
                <dt>住所</dt>
                <dd>{card.address || "-"}</dd>
                <dt>Webサイト</dt>
                <dd>{card.website || "-"}</dd>
                <dt>メモ</dt>
                <dd>{card.note || "-"}</dd>
              </dl>
            )}

            <div className="modal-actions">
              {editing ? (
                <>
                  <button onClick={() => setEditing(false)} disabled={busy}>
                    キャンセル
                  </button>
                  <button className="primary" onClick={handleSaveEdit} disabled={busy}>
                    {busy ? "保存中…" : "変更を保存"}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setEditing(true)} disabled={busy}>
                    ✏️ 編集
                  </button>
                  {confirmingDelete ? (
                    <>
                      <button onClick={() => setConfirmingDelete(false)} disabled={busy}>
                        キャンセル
                      </button>
                      <button className="danger" onClick={handleDelete} disabled={busy}>
                        {busy ? "削除中…" : "本当に削除する"}
                      </button>
                    </>
                  ) : (
                    <button className="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
                      🗑 削除
                    </button>
                  )}
                </>
              )}
            </div>

            {!editing && (
              <div className="share-actions">
                <button className="primary" onClick={() => shareViaLine(cardToShareText(card))}>
                  LINEで共有
                </button>
                {canUseWebShare() && (
                  <button onClick={() => shareViaWebShare(card.name || "名刺", cardToShareText(card))}>共有…</button>
                )}
                <button onClick={handleCopy}>{copied ? "コピーしました ✓" : "テキストをコピー"}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
