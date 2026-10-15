// Holdings import from a broker screenshot (ADR 0018). The image is read by an open vision model
// on the owner's own Ollama; nothing is sent anywhere else.

/** One holding read from a screenshot. `null`: not found in the image; the owner fills it in. */
export interface ImportedHolding {
  symbol: string;
  shares: number | null;
  /** Average cost per share, as shown in the screenshot. */
  averageCost: number | null;
}

/** POST /api/portfolio-import result. `warning`: read, but something needs the owner's eye. */
export type HoldingsReadResult =
  | { ok: true; holdings: ImportedHolding[]; warning?: string }
  | { ok: false; error: { code: string; message: string } };

/** Upload limit for one screenshot (a 4K PNG is ~5–10 MB). */
export const MAX_IMPORT_IMAGE_BYTES = 20 * 1024 * 1024;

export const IMPORT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Most trades one import may save at once. */
export const MAX_IMPORT_ROWS = 100;
