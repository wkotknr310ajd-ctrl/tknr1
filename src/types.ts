export interface BusinessCard {
  /** Drive file id once saved. Empty string for an unsaved draft. */
  id: string;
  name: string;
  company: string;
  title: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  website: string;
  note: string;
  /** Full raw OCR text, kept for reference / re-parsing. */
  rawText: string;
  /** Resized JPEG photo of the card, as a data URL. */
  imageDataUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight entry used for the list view, parsed from the Drive filename
 * so listing doesn't require downloading every card's full content. */
export interface CardSummary {
  id: string;
  name: string;
  company: string;
  createdAt: string;
}
