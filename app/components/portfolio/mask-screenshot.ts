// Masks a broker screenshot on this computer before it goes to Claude (ADR 0021). Allow-list:
// the output starts black and only OCR lines judged safe by `ocrLineVerdict` are copied back, so
// photos, names, account numbers and anything OCR can't read never leave the machine.

import { createWorker } from "tesseract.js";

import { ocrLineVerdict } from "~/lib/pii";

/** OCR reads small print badly; narrower screenshots are enlarged ×2 for reading only. */
const OCR_MIN_WIDTH = 1600;
/** Pixels of the original image kept around each line, so glyph edges aren't clipped. */
const PADDING = 2;

export interface MaskedScreenshot {
  /** PNG of the masked screenshot (fresh canvas output, so no EXIF/GPS metadata). */
  image: Blob;
  keptLines: number;
  hiddenLines: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas unavailable");
  return context;
}

/** True when most of the image is dark (dark theme), so OCR gets an inverted copy. */
function isDark(bitmap: ImageBitmap): boolean {
  const sample = canvasOf(64, 64);
  sample.drawImage(bitmap, 0, 0, 64, 64);
  const { data } = sample.getImageData(0, 0, 64, 64);
  let luminance = 0;
  for (let index = 0; index < data.length; index += 4) {
    luminance +=
      0.2126 * (data[index] ?? 0) +
      0.7152 * (data[index + 1] ?? 0) +
      0.0722 * (data[index + 2] ?? 0);
  }
  return luminance / (data.length / 4) < 128;
}

/**
 * Reads the screenshot with on-device OCR (tesseract.js, assets served by Krestrel from
 * `/ocr/*`) and returns a copy where everything but holdings rows and column headers is black.
 */
export async function maskForClaude(
  image: Blob,
  onProgress?: (fraction: number) => void,
): Promise<MaskedScreenshot> {
  const bitmap = await createImageBitmap(image);
  try {
    const factor = bitmap.width < OCR_MIN_WIDTH ? 2 : 1;
    const ocr = canvasOf(bitmap.width * factor, bitmap.height * factor);
    ocr.filter = isDark(bitmap) ? "grayscale(1) invert(1)" : "grayscale(1)";
    ocr.imageSmoothingQuality = "high";
    ocr.drawImage(bitmap, 0, 0, ocr.canvas.width, ocr.canvas.height);

    const origin = window.location.origin;
    const worker = await createWorker("eng", 1, {
      workerPath: `${origin}/ocr/worker.min.js`,
      corePath: `${origin}/ocr`,
      langPath: `${origin}/ocr`,
      logger: (message) => {
        if (message.status === "recognizing text") onProgress?.(message.progress);
      },
    });
    let lines: Array<{ words: Array<{ text: string; bbox: Box }>; bbox: Box }>;
    try {
      const { data } = await worker.recognize(ocr.canvas, {}, { blocks: true });
      lines = (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) => paragraph.lines),
      );
    } finally {
      await worker.terminate();
    }

    const out = canvasOf(bitmap.width, bitmap.height);
    out.fillStyle = "#000";
    out.fillRect(0, 0, bitmap.width, bitmap.height);
    // Boxes are in OCR pixels; scale back to the screenshot and clamp to its edges.
    const toImage = (box: Box, pad: number) => {
      const x = Math.max(0, Math.floor(box.x0 / factor) - pad);
      const y = Math.max(0, Math.floor(box.y0 / factor) - pad);
      return {
        x,
        y,
        width: Math.min(bitmap.width, Math.ceil(box.x1 / factor) + pad) - x,
        height: Math.min(bitmap.height, Math.ceil(box.y1 / factor) + pad) - y,
      };
    };

    const hidden: Box[] = [];
    let keptLines = 0;
    for (const line of lines) {
      const words = line.words.filter((word) => word.text.trim() !== "");
      const verdict = ocrLineVerdict(words.map((word) => word.text.trim()));
      if (!verdict.keep) {
        hidden.push(...words.map((word) => word.bbox));
        continue;
      }
      keptLines++;
      const { x, y, width, height } = toImage(line.bbox, PADDING);
      out.drawImage(bitmap, x, y, width, height, x, y, width, height);
      for (const index of verdict.maskWords) {
        const word = words[index];
        if (word) hidden.push(word.bbox);
      }
    }
    // Hidden words last: a kept line's padding must not reveal an edge of a hidden neighbour.
    for (const box of hidden) {
      const { x, y, width, height } = toImage(box, PADDING + 1);
      out.fillRect(x, y, width, height);
    }

    const { promise, resolve, reject } = Promise.withResolvers<Blob>();
    out.canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
      "image/png",
    );
    return { image: await promise, keptLines, hiddenLines: lines.length - keptLines };
  } finally {
    bitmap.close();
  }
}
