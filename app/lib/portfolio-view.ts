/**
 * True when going from `current` to `next` only switches the portfolio tab (`?view=`): nothing
 * the portfolio loader returns depends on it, so the page can skip a server round trip. A
 * navigation to the very same URL is not a tab switch (it's how the owner asks for fresh data).
 */
export function onlyViewChanged(current: URL, next: URL): boolean {
  if (current.pathname + current.search === next.pathname + next.search) return false;
  const withoutView = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete("view");
    return `${url.pathname}?${params}`;
  };
  return withoutView(current) === withoutView(next);
}
