const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

export function getVisionApiKey(): string {
  return (import.meta.env.VITE_GOOGLE_VISION_API_KEY as string | undefined) ?? "";
}

export function isVisionConfigured(): boolean {
  return getVisionApiKey().length > 0;
}

function dataUrlToBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

interface VisionAnnotateResponse {
  responses?: Array<{
    fullTextAnnotation?: { text?: string };
    error?: { message?: string };
  }>;
  error?: { message?: string };
}

/** Runs OCR via Google Cloud Vision's DOCUMENT_TEXT_DETECTION. Reads Japanese
 * business cards far more reliably than the in-browser Tesseract.js engine. */
export async function recognizeCardTextVision(imageDataUrl: string): Promise<string> {
  const apiKey = getVisionApiKey();
  const res = await fetch(`${VISION_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: dataUrlToBase64(imageDataUrl) },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["ja", "en"] }
        }
      ]
    })
  });

  const json = (await res.json()) as VisionAnnotateResponse;
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Vision API error ${res.status}`);
  }

  const result = json.responses?.[0];
  if (result?.error) {
    throw new Error(result.error.message ?? "Vision API error");
  }
  return (result?.fullTextAnnotation?.text ?? "").trim();
}
