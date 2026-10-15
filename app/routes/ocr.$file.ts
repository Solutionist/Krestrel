import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { Route } from "./+types/ocr.$file";

const require = createRequire(import.meta.url);
const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

/**
 * Files the browser's on-device OCR needs (ADR 0021), served from node_modules so tesseract.js
 * never fetches its worker, engine or English model from a CDN. Only the LSTM engine builds are
 * listed: the worker runs with OEM 1 (LSTM only) and picks one by the browser's SIMD support.
 */
const FILES: Record<string, { path: () => string; type: string }> = {
  "worker.min.js": {
    path: () => join(packageDir("tesseract.js"), "dist", "worker.min.js"),
    type: "text/javascript",
  },
  "tesseract-core-lstm.wasm.js": {
    path: () => join(packageDir("tesseract.js-core"), "tesseract-core-lstm.wasm.js"),
    type: "text/javascript",
  },
  "tesseract-core-simd-lstm.wasm.js": {
    path: () => join(packageDir("tesseract.js-core"), "tesseract-core-simd-lstm.wasm.js"),
    type: "text/javascript",
  },
  "tesseract-core-relaxedsimd-lstm.wasm.js": {
    path: () => join(packageDir("tesseract.js-core"), "tesseract-core-relaxedsimd-lstm.wasm.js"),
    type: "text/javascript",
  },
  // Gzipped model file; tesseract.js unzips it itself, so no Content-Encoding header.
  "eng.traineddata.gz": {
    path: () => join(packageDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"),
    type: "application/octet-stream",
  },
};

/** GET /ocr/:file → one of the allow-listed OCR assets above; 404 for anything else. */
export async function loader({ params }: Route.LoaderArgs) {
  const file = Object.hasOwn(FILES, params.file) ? FILES[params.file] : undefined;
  if (!file) return new Response("Not found", { status: 404 });
  const body = await readFile(file.path());
  return new Response(body, {
    headers: {
      "content-type": file.type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
