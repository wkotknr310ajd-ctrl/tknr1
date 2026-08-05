import { createWorker, PSM, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;
let currentOnProgress: ((progress: number) => void) | undefined;

async function initWorker(): Promise<Worker> {
  const worker = await createWorker("jpn+eng", 1, {
    logger: (msg) => {
      if (msg.status === "recognizing text" && currentOnProgress) {
        currentOnProgress(msg.progress);
      }
    }
  });
  // Business cards are scattered blocks of text rather than a single
  // document layout, so "sparse text" segmentation reads them far more
  // reliably than Tesseract's default fully-automatic page segmentation.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  return worker;
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = initWorker();
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
