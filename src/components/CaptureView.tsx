import { useEffect, useRef, useState } from "react";
import type { BusinessCard } from "../types";
import { captureVideoFrame, fileToDataUrl, prepareForOcr, resizeDataUrl } from "../lib/image";
import { recognizeCardText } from "../lib/ocr";
import { isVisionConfigured, recognizeCardTextVision } from "../lib/visionOcr";
import { parseCardText, type ParsedFields } from "../lib/parser";
import CardForm, { type FormFields } from "./CardForm";

interface Props {
  signedIn: boolean;
  onRequestSignIn: () => void;
  onSave: (card: BusinessCard) => Promise<string | undefined>;
}

interface PendingCard {
  /** Full-resolution image used for OCR only, never stored. */
  ocrSource: string;
  /** Smaller, compressed image saved with the card. */
  storageImage: string;
}

const EMPTY_FIELDS: FormFields = {
  name: "",
  company: "",
  title: "",
  phone: "",
  fax: "",
  email: "",
  address: "",
  website: "",
  note: ""
};

export default function CaptureView({ signedIn, onRequestSignIn, onSave }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Images picked (camera or file picker) waiting to be reviewed/saved, in order.
  // pendingImages[0] is the one currently shown for OCR + editing.
  const [pendingImages, setPendingImages] = useState<PendingCard[]>([]);
  const [totalInBatch, setTotalInBatch] = useState(0);
  const processedImage = useRef<string | null>(null);

  const [rawText, setRawText] = useState("");
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
      } catch {
        setCameraError("カメラを利用できません。下の「画像を選択」から名刺の写真を選んでください。");
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const current = pendingImages[0] ?? null;

  // Automatically start OCR whenever a new image reaches the front of the queue.
  useEffect(() => {
    if (current && processedImage.current !== current.ocrSource) {
      processedImage.current = current.ocrSource;
      void runOcr(current.ocrSource);
    }
    if (!current) {
      setTotalInBatch(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  async function runOcr(ocrSource: string) {
    setOcrRunning(true);
    setOcrProgress(0);
    setSaveError(null);
    setFields(EMPTY_FIELDS);
    try {
      let text: string;
      if (isVisionConfigured()) {
        // Vision reads the original color photo better than a grayscale one;
        // just cap the resolution to keep the request small and fast.
        const visionImage = await resizeDataUrl(ocrSource, 1600, 0.92);
        text = await recognizeCardTextVision(visionImage);
      } else {
        const ocrImage = await prepareForOcr(ocrSource);
        text = await recognizeCardText(ocrImage, setOcrProgress);
      }
      setRawText(text);
      const parsed: ParsedFields = parseCardText(text);
      setFields({ ...parsed, note: "" });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "文字の読み取りに失敗しました");
    } finally {
      setOcrRunning(false);
    }
  }

  async function handleCapture() {
    if (!videoRef.current) return;
    const raw = captureVideoFrame(videoRef.current);
    const storageImage = await resizeDataUrl(raw);
    setPendingImages((q) => [...q, { ocrSource: raw, storageImage }]);
    setTotalInBatch((n) => n + 1);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const newCards = await Promise.all(
      files.map(async (file): Promise<PendingCard> => {
        const raw = await fileToDataUrl(file);
        const storageImage = await resizeDataUrl(raw);
        return { ocrSource: raw, storageImage };
      })
    );
    setPendingImages((q) => [...q, ...newCards]);
    setTotalInBatch((n) => n + newCards.length);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function advanceQueue() {
    setPendingImages((q) => q.slice(1));
    setRawText("");
    setFields(EMPTY_FIELDS);
    setSaveError(null);
  }

  function handleSkip() {
    advanceQueue();
  }

  async function handleSave() {
    if (!current) return;
    if (!signedIn) {
      onRequestSignIn();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      const card: BusinessCard = {
        id: "",
        ...fields,
        rawText,
        imageDataUrl: current.storageImage,
        createdAt: now,
        updatedAt: now
      };
      await onSave(card);
      setSaved(true);
      advanceQueue();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const remainingCount = pendingImages.length;
  const currentPosition = totalInBatch > 0 ? totalInBatch - remainingCount + 1 : 0;

  return (
    <div className="capture-view">
      {saved && remainingCount === 0 && (
        <div className="banner banner-success">保存しました。「一覧」タブから確認できます。</div>
      )}
      {!current && (
        <div className="camera-box">
          {cameraError ? <p className="muted">{cameraError}</p> : null}
          <video ref={videoRef} className={cameraReady ? "" : "hidden"} playsInline muted />
          <div className="capture-actions">
            {cameraReady && (
              <button className="primary" onClick={handleCapture}>
                📷 撮影する
              </button>
            )}
            <label className="file-picker">
              画像を選択(複数可)
              <input type="file" accept="image/*" multiple onChange={handleFilesChange} />
            </label>
          </div>
          <p className="muted">
            「画像を選択」からは、スマホ内の写真・Googleフォト・ファイルアプリなどから複数枚まとめて選べます。
          </p>
        </div>
      )}

      {current && (
        <div className="review-box">
          {totalInBatch > 1 && (
            <p className="muted">
              {currentPosition} / {totalInBatch} 枚目(残り {remainingCount} 枚)
            </p>
          )}
          <img className="card-photo" src={current.storageImage} alt="名刺" />
          {ocrRunning ? (
            <div className="ocr-progress">
              <p>文字を読み取っています…{ocrProgress > 0 ? ` ${Math.round(ocrProgress * 100)}%` : ""}</p>
              <progress value={ocrProgress > 0 ? ocrProgress : undefined} max={1} />
            </div>
          ) : (
            <>
              <p className="muted">
                自動で読み取った内容です。誤りがあれば修正してから保存してください。
              </p>
              <CardForm value={fields} onChange={(patch) => setFields((f) => ({ ...f, ...patch }))} />
              {saveError && <div className="banner banner-error">{saveError}</div>}
              <div className="review-actions">
                <button onClick={handleSkip} disabled={saving}>
                  スキップ
                </button>
                <button className="primary" onClick={handleSave} disabled={saving}>
                  {saving ? "保存中…" : signedIn ? "Googleドライブに保存" : "サインインして保存"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
