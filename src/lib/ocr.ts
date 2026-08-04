import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;
let currentOnProgress: ((progress: number) => void) | undefined;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("jpn+eng", 1, {
      logger: (msg) => {
        if (msg.status === "recognizing text" && currentOnProgress) {
          currentOnProgress(msg.progress);
        }
      }
    });
  }
  return workerPromise;
}

/** Runs OCR on an image (data URL) and returns the recognized raw text. */
export async function recognizeCardText(imageDataUrl: string, onProgress?: (progress: number) => void): Promise<string> {
  currentOnProgress = onProgress;
  const worker = await getWorker();
  const {
    data: { text }
  } = await worker.recognize(imageDataUrl);
  return text.trim();
}
