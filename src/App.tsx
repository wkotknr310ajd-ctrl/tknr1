import { useCallback, useEffect, useState } from "react";
import type { BusinessCard, CardSummary } from "./types";
import * as auth from "./lib/googleAuth";
import * as drive from "./lib/drive";
import Header from "./components/Header";
import CaptureView from "./components/CaptureView";
import CardList from "./components/CardList";
import CardDetailModal from "./components/CardDetailModal";
import TimerView from "./components/TimerView";

type View = "list" | "capture" | "timer";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<CardSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [view, setView] = useState<View>("list");
  const [detailCard, setDetailCard] = useState<BusinessCard | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const configured = auth.isConfigured();

  const refreshList = useCallback(async (t: string, fId: string) => {
    setLoadingList(true);
    setError(null);
    try {
      const list = await drive.listCardSummaries(t, fId);
      setSummaries(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "一覧の取得に失敗しました");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const signIn = useCallback(
    async (interactive: boolean) => {
      setAuthBusy(true);
      setError(null);
      try {
        const t = await auth.requestAccessToken(interactive);
        if (!t) {
          if (interactive) setError("Googleへのサインインがキャンセルされました");
          return;
        }
        setToken(t);
        const fId = await drive.getOrCreateFolder(t);
        setFolderId(fId);
        await refreshList(t, fId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "サインインに失敗しました");
      } finally {
        setAuthBusy(false);
      }
    },
    [refreshList]
  );

  useEffect(() => {
    if (configured && auth.getCachedToken()) {
      void signIn(false);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = () => {
    auth.signOut();
    setToken(null);
    setFolderId(null);
    setSummaries([]);
  };

  const handleSaveNewCard = async (card: BusinessCard) => {
    if (!token || !folderId) {
      setError("保存にはGoogleサインインが必要です");
      return undefined;
    }
    const id = await drive.createCard(token, folderId, card);
    await refreshList(token, folderId);
    return id;
  };

  const openCard = async (id: string) => {
    if (!token) return;
    setDetailLoading(true);
    setError(null);
    try {
      const card = await drive.fetchCard(token, id);
      setDetailCard(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "名刺データの取得に失敗しました");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleUpdateCard = async (card: BusinessCard) => {
    if (!token) return;
    await drive.updateCard(token, card.id, card);
    setDetailCard(card);
    if (folderId) await refreshList(token, folderId);
  };

  const handleDeleteCard = async (id: string) => {
    if (!token) return;
    await drive.deleteCard(token, id);
    setDetailCard(null);
    if (folderId) await refreshList(token, folderId);
  };

  return (
    <div className="app">
      <Header
        signedIn={!!token}
        authBusy={authBusy}
        onSignIn={() => void signIn(true)}
        onSignOut={signOut}
        view={view}
        onChangeView={setView}
        configured={configured}
      />
      {!configured && (
        <div className="banner banner-error">
          Google Client IDが未設定です。README の手順に従って .env に VITE_GOOGLE_CLIENT_ID を設定してください。
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      <main>
        {view === "capture" ? (
          <CaptureView signedIn={!!token} onRequestSignIn={() => void signIn(true)} onSave={handleSaveNewCard} />
        ) : view === "timer" ? (
          <TimerView />
        ) : (
          <CardList
            summaries={summaries}
            loading={loadingList}
            signedIn={!!token}
            onOpen={openCard}
            onRefresh={() => token && folderId && void refreshList(token, folderId)}
          />
        )}
      </main>
      {(detailCard || detailLoading) && (
        <CardDetailModal
          card={detailCard}
          loading={detailLoading}
          onClose={() => setDetailCard(null)}
          onUpdate={handleUpdateCard}
          onDelete={handleDeleteCard}
        />
      )}
    </div>
  );
}
