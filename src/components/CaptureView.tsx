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
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
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

  async function runOcr(dataUrl: string) {
    setOcrRunning(true);
    setOcrProgress(0);
    setSaveError(null);
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
    setImageDataUrl(resized);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await runOcr(resized);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const raw = await fileToDataUrl(file);
    const resized = await resizeDataUrl(raw);
    setImageDataUrl(resized);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await runOcr(resized);
  }

  function handleRetake() {
    setImageDataUrl(null);
    setRawText("");
    setFields(EMPTY_FIELDS);
    setSaved(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!imageDataUrl) return;
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
        imageDataUrl,
        createdAt: now,
        updatedAt: now
      };
      await onSave(card);
      setSaved(true);
      handleRetake();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="capture-view">
      {saved && <div className="banner banner-success">保存しました。「一覧」タブから確認できます。</div>}
      {!imageDataUrl && (
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
              画像を選択
              <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} />
            </label>
          </div>
        </div>
      )}

      {imageDataUrl && (
        <div className="review-box">
          <img className="card-photo" src={imageDataUrl} alt="撮影した名刺" />
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
                <button onClick={handleRetake} disabled={saving}>
                  撮り直す
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
