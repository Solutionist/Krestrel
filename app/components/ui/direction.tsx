/** ▲/▼ with screen-reader text, so the direction never relies on colour. */
export function Direction({ value }: { value: number }) {
  if (Math.abs(value) < 1e-9) return null;
  return (
    <>
      <span aria-hidden>{value > 0 ? "▲ " : "▼ "}</span>
      <span className="sr-only">{value > 0 ? "up " : "down "}</span>
    </>
  );
}
