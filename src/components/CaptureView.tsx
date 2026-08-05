import { useEffect, useRef, useState } from "react";
import type { BusinessCard } from "../types";
import { captureVideoFrame, fileToDataUrl, resizeDataUrl } from "../lib/image";
import { recognizeCardText } from "../lib/ocr";
import { parseCardText, type ParsedFields } from "../lib/parser";
import CardForm, { type FormFields } from "./CardForm";

interface Props {
  signedIn: boolean;
  onRequestSignIn: () => void;
  onSave: (card: BusinessCard) => Promise<string | undefined>;
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
  const [pendingImages, setPendingImages] = useState<string[]>([]);
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

  const currentImage = pendingImages[0] ?? null;

  // Automatically start OCR whenever a new image reaches the front of the queue.
  useEffect(() => {
    if (currentImage && processedImage.current !== currentImage) {
      processedImage.current = currentImage;
      void runOcr(currentImage);
    }
    if (!currentImage) {
      setTotalInBatch(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage]);

  async function runOcr(dataUrl: string) {
    setOcrRunning(true);
    setOcrProgress(0);
    setSaveError(null);
    setFields(EMPTY_FIELDS);
    try {
      const text = await recognizeCardText(dataUrl, setOcrProgress);
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
    const resized = await resizeDataUrl(raw);
    setPendingImages((q) => [...q, resized]);
    setTotalInBatch((n) => n + 1);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const resizedImages = await Promise.all(
      files.map(async (file) => resizeDataUrl(await fileToDataUrl(file)))
    );
    setPendingImages((q) => [...q, ...resizedImages]);
    setTotalInBatch((n) => n + resizedImages.length);
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
    if (!currentImage) return;
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
        imageDataUrl: currentImage,
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
      {!currentImage && (
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

      {currentImage && (
        <div className="review-box">
          {totalInBatch > 1 && (
            <p className="muted">
              {currentPosition} / {totalInBatch} 枚目(残り {remainingCount} 枚)
            </p>
          )}
          <img className="card-photo" src={currentImage} alt="名刺" />
          {ocrRunning ? (
            <div className="ocr-progress">
              <p>文字を読み取っています… {Math.round(ocrProgress * 100)}%</p>
              <progress value={ocrProgress} max={1} />
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
