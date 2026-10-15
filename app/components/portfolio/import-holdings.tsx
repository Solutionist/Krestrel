import {
  CheckCircleIcon,
  CircleNotchIcon,
  ImageSquareIcon,
  PlusIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type DragEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { Button, IconButton } from "~/components/ui/button";
import { FIELD, HEADING, LABEL } from "~/components/ui/styles";
import { nyDay } from "~/lib/candles";
import { type HoldingsReadResult, MAX_IMPORT_ROWS } from "~/lib/holdings-import";
import { type PortfolioActionResult, type TradeInput, TradeInputSchema } from "~/lib/portfolio";

/**
 * Largest image sent to the vision model. Its cost grows with pixels (~1 token per 32×32 px);
 * 3.2 MP keeps a full phone screenshot (e.g. 1179×2556) sharp enough to read small print.
 */
const MAX_VISION_PIXELS = 3_200_000;

const CELL = `${FIELD} h-8 w-full tabular-nums`;

interface Row {
  key: number;
  symbol: string;
  shares: string;
  price: string;
}

/** Shrinks screenshots above MAX_VISION_PIXELS (never enlarges) and re-encodes them as PNG. */
async function prepareForVision(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, Math.sqrt(MAX_VISION_PIXELS / (bitmap.width * bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
    "image/png",
  );
  return promise;
}

/**
 * Reads holdings from a broker screenshot (pasted, dropped or chosen) on this computer, lets the
 * owner correct them, then records each as one buy at its average cost (ADR 0018).
 */
export function ImportHoldings({
  portfolios,
  portfolioId,
  image,
  onClose,
}: {
  portfolios: readonly { id: string; name: string }[];
  /** Portfolio to import into; null asks the owner to pick one. */
  portfolioId: string | null;
  /** A screenshot pasted on the page; read as soon as it arrives. */
  image: Blob | null;
  onClose: () => void;
}) {
  const ids = useId();
  const reader = useFetcher<HoldingsReadResult>();
  const saver = useFetcher<PortfolioActionResult>();
  const panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const savingCount = useRef(0);
  const lastImage = useRef<Blob | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<{ message: string; rowKey?: number } | null>(null);
  const [tradedOn, setTradedOn] = useState(() => nyDay(Date.now()));
  const [target, setTarget] = useState(portfolioId ?? portfolios[0]?.id ?? "");
  const [saved, setSaved] = useState<number | null>(null);

  const reading = preparing || reader.state !== "idle";
  const saving = saver.state !== "idle";
  const readResult = reader.data;
  const saveResult = saver.data;
  const { submit } = reader;

  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  // Follow the portfolio picked in the sidebar while the panel is open.
  useEffect(() => {
    if (portfolioId) setTarget(portfolioId);
  }, [portfolioId]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const read = useCallback(
    async (file: Blob) => {
      if (!file.type.startsWith("image/")) {
        setProblem({ message: "That isn't an image. Paste or choose a screenshot." });
        return;
      }
      setProblem(null);
      setRows(null);
      setSaved(null);
      setPreview(URL.createObjectURL(file));
      setPreparing(true);
      try {
        const form = new FormData();
        form.append("image", await prepareForVision(file), "screenshot.png");
        submit(form, {
          method: "post",
          action: "/api/portfolio-import",
          encType: "multipart/form-data",
        });
      } catch {
        setProblem({ message: "Couldn't open that image. Try a PNG or JPEG screenshot." });
      } finally {
        setPreparing(false);
      }
    },
    [submit],
  );

  useEffect(() => {
    if (!image || image === lastImage.current) return;
    lastImage.current = image;
    void read(image);
  }, [image, read]);

  useEffect(() => {
    if (reader.state !== "idle" || !readResult?.ok) return;
    const { holdings } = readResult;
    setRows(
      holdings.slice(0, MAX_IMPORT_ROWS).map((holding) => ({
        key: nextKey.current++,
        symbol: holding.symbol,
        shares: holding.shares === null ? "" : String(holding.shares),
        price: holding.averageCost === null ? "" : String(holding.averageCost),
      })),
    );
    if (holdings.length > MAX_IMPORT_ROWS) {
      setProblem({
        message: `Read ${holdings.length} holdings; one import takes ${MAX_IMPORT_ROWS}. Import these, then crop the rest into another screenshot.`,
      });
    }
  }, [reader.state, readResult]);

  useEffect(() => {
    if (saver.state !== "idle" || !saveResult?.ok) return;
    setSaved(savingCount.current);
    setRows(null);
  }, [saver.state, saveResult]);

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  }

  function update(key: number, change: Partial<Row>) {
    setRows(
      (current) => current?.map((row) => (row.key === key ? { ...row, ...change } : row)) ?? null,
    );
  }

  function save() {
    if (!rows) return;
    const trades: TradeInput[] = [];
    for (const [index, row] of rows.entries()) {
      const label = `Row ${index + 1}${row.symbol ? ` (${row.symbol})` : ""}`;
      if (row.price.trim() === "") {
        setProblem({ message: `${label}: enter the average cost`, rowKey: row.key });
        return;
      }
      const parsed = TradeInputSchema.safeParse({
        symbol: row.symbol,
        side: "buy",
        shares: row.shares,
        price: row.price,
        fee: 0,
        tradedOn,
      });
      if (!parsed.success) {
        setProblem({
          message: `${label}: ${parsed.error.issues[0]?.message ?? "check this row"}`,
          rowKey: row.key,
        });
        return;
      }
      trades.push(parsed.data);
    }
    if (trades.length === 0) {
      setProblem({ message: "Add at least one holding." });
      return;
    }
    setProblem(null);
    savingCount.current = trades.length;
    saver.submit(
      { intent: "importTrades", portfolioId: target, trades },
      { method: "post", action: "/api/portfolios", encType: "application/json" },
    );
  }

  const message =
    problem?.message ??
    (saveResult && !saveResult.ok && !saving ? saveResult.error.message : null) ??
    (readResult && !readResult.ok && !reading && rows === null ? readResult.error.message : null);
  const warning =
    saved !== null
      ? saveResult?.ok
        ? saveResult.warning
        : undefined
      : rows !== null && readResult?.ok
        ? readResult.warning
        : undefined;
  const targetName = portfolios.find((portfolio) => portfolio.id === target)?.name ?? "";

  return (
    <section
      ref={panel}
      aria-labelledby={`${ids}-title`}
      className="grid gap-4 rounded-xl bg-subtle p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 id={`${ids}-title`} className={HEADING}>
            Import from a screenshot
          </h3>
          <p className="text-xs text-muted">
            Read by your local vision model (Ollama); the image isn't sent anywhere.
          </p>
        </div>
        <IconButton label="Close import" onClick={onClose}>
          <XIcon aria-hidden size={15} />
        </IconButton>
      </div>

      {saved !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="flex items-center gap-1.5 text-sm text-text">
            <CheckCircleIcon aria-hidden size={16} className="shrink-0 text-accent" />
            Imported {saved} {saved === 1 ? "holding" : "holdings"} into {targetName}.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setSaved(null)}>
              Import another
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : rows === null ? (
        <section
          aria-label="Screenshot drop zone"
          aria-busy={reading}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={`grid min-h-36 place-items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors duration-150 ${
            dragging ? "border-accent bg-accent/5" : "border-rule"
          }`}
        >
          {reading ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <CircleNotchIcon aria-hidden size={16} className="animate-spin text-accent" />
              Reading the screenshot… the first read of a session also loads the model.
            </p>
          ) : (
            <div className="grid justify-items-center gap-2">
              <ImageSquareIcon aria-hidden size={24} className="text-accent" />
              <p className="text-sm text-text">
                Paste a screenshot (Ctrl+V), drop it here, or{" "}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="rounded-md font-medium text-accent transition-colors duration-150 hover:text-accent/80"
                >
                  choose a file
                </button>
              </p>
              <p className="text-xs text-muted">
                Crop it to your positions: each row needs the ticker, shares and average cost.
              </p>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void read(file);
            }}
          />
        </section>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <div className="grid content-start gap-2">
              <p className="text-xs text-muted">
                Found {rows.length} {rows.length === 1 ? "holding" : "holdings"}. Check each row
                against the screenshot; each is saved as one buy at its average cost.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-left ${LABEL}`}>
                    <th className="pb-1.5 font-medium">Ticker</th>
                    <th className="pb-1.5 pl-2 font-medium">Shares</th>
                    <th className="pb-1.5 pl-2 font-medium">Avg cost (USD)</th>
                    <th className="w-8 pb-1.5">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const name = row.symbol || `Row ${index + 1}`;
                    const invalid = problem?.rowKey === row.key;
                    return (
                      <tr key={row.key}>
                        <td className="py-1">
                          <input
                            value={row.symbol}
                            onChange={(event) =>
                              update(row.key, { symbol: event.target.value.toUpperCase() })
                            }
                            aria-label={`${name} ticker`}
                            aria-invalid={invalid || undefined}
                            placeholder="AAPL"
                            autoComplete="off"
                            spellCheck={false}
                            className={`${CELL} font-medium`}
                          />
                        </td>
                        <td className="py-1 pl-2">
                          <input
                            value={row.shares}
                            onChange={(event) => update(row.key, { shares: event.target.value })}
                            aria-label={`${name} shares`}
                            aria-invalid={invalid || undefined}
                            inputMode="decimal"
                            placeholder="10"
                            className={CELL}
                          />
                        </td>
                        <td className="py-1 pl-2">
                          <input
                            value={row.price}
                            onChange={(event) => update(row.key, { price: event.target.value })}
                            aria-label={`${name} average cost`}
                            aria-invalid={invalid || undefined}
                            inputMode="decimal"
                            placeholder="150.25"
                            className={CELL}
                          />
                        </td>
                        <td className="py-1 pl-1">
                          <IconButton
                            label={`Remove ${name}`}
                            variant="danger"
                            onClick={() =>
                              setRows(rows.filter((candidate) => candidate.key !== row.key))
                            }
                          >
                            <XIcon aria-hidden size={14} />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={rows.length >= MAX_IMPORT_ROWS}
                  onClick={() =>
                    setRows([
                      ...rows,
                      { key: nextKey.current++, symbol: "", shares: "", price: "" },
                    ])
                  }
                >
                  <PlusIcon aria-hidden size={14} />
                  Add row
                </Button>
              </div>
            </div>
            {preview && (
              <img
                src={preview}
                alt="The screenshot being imported"
                className="max-h-80 w-full rounded-lg object-contain object-top ring-1 ring-rule/60"
              />
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5">
              <span className={LABEL}>Bought on</span>
              <input
                type="date"
                value={tradedOn}
                onChange={(event) => setTradedOn(event.target.value)}
                max={nyDay(Date.now())}
                required
                className={`${FIELD} h-9 tabular-nums`}
              />
            </label>
            {portfolios.length > 1 && (
              <label className="grid gap-1.5">
                <span className={LABEL}>Portfolio</span>
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className={`${FIELD} h-9 pr-8`}
                >
                  {portfolios.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button variant="primary" onClick={save} disabled={saving || rows.length === 0}>
              {saving
                ? "Importing…"
                : `Import ${rows.length} ${rows.length === 1 ? "holding" : "holdings"}`}
            </Button>
            <Button variant="ghost" onClick={() => setRows(null)}>
              Use another screenshot
            </Button>
          </div>
        </>
      )}

      {message && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
          {message}
        </p>
      )}
      {warning && (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-lg bg-accent/8 px-3 py-2 text-xs text-text ring-1 ring-inset ring-accent/20"
        >
          <WarningCircleIcon aria-hidden size={14} className="shrink-0 text-accent" />
          {warning}
        </p>
      )}
    </section>
  );
}
