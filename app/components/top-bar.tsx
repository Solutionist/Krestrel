import {
  CaretDownIcon,
  ChartLineUpIcon,
  DesktopIcon,
  LightbulbIcon,
  MoonIcon,
  SunIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { NavLink } from "react-router";

import { useCurrency } from "~/hooks/use-currency";
import { type ThemePreference, themePreference } from "~/hooks/use-theme";
import { BASE_CURRENCY, currencyName } from "~/lib/currency";
import type { ConnectionText, MarketText } from "~/lib/status-text";

import { Segmented } from "./ui/segmented";

const TONE_DOT: Record<ConnectionText["tone"], string> = {
  ok: "bg-rise",
  busy: "bg-accent animate-pulse",
  error: "bg-fall",
};

const NAV = [
  { to: "/", label: "Markets", Icon: ChartLineUpIcon },
  { to: "/ideas", label: "Ideas", Icon: LightbulbIcon },
  { to: "/portfolio", label: "Portfolio", Icon: WalletIcon },
] as const;

const THEME_OPTIONS = [
  { value: "light", label: <SunIcon size={15} />, ariaLabel: "Light theme" },
  { value: "dark", label: <MoonIcon size={15} />, ariaLabel: "Dark theme" },
  { value: "system", label: <DesktopIcon size={15} />, ariaLabel: "Match system theme" },
] as const satisfies readonly {
  value: ThemePreference;
  label: React.ReactNode;
  ariaLabel: string;
}[];

export function TopBar({
  market,
  connection,
  dataLabel,
}: {
  market: MarketText;
  connection: ConnectionText;
  dataLabel: string;
}) {
  const [theme, setTheme] = themePreference.use();
  return (
    <header className="flex h-14 shrink-0 items-center gap-5 px-4 text-sm">
      <span className="flex items-center gap-2.5">
        <img src="/brand/krestrel-mark.svg" alt="" aria-hidden className="size-7" />
        <span className="text-[15px] font-semibold tracking-tight text-text">Krestrel</span>
      </span>

      <nav aria-label="Sections" className="flex items-center gap-1">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-colors duration-150 ${
                isActive
                  ? "bg-panel text-text shadow-sm ring-1 ring-rule/80"
                  : "text-muted hover:bg-subtle hover:text-text"
              }`
            }
          >
            <Icon size={16} weight="duotone" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <span
        className="hidden items-center gap-2 rounded-full bg-subtle px-3 py-1 text-xs md:inline-flex"
        title={market.title}
      >
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${market.isOpen ? "bg-rise" : "bg-muted/70"}`}
        />
        <span className="font-medium text-text">{market.label}</span>
        {market.detail && <span className="hidden text-muted lg:inline">{market.detail}</span>}
      </span>

      <span className="ml-auto hidden text-xs text-muted xl:inline">{dataLabel}</span>

      <CurrencySelect />

      <Segmented label="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />

      <span
        className="inline-flex items-center gap-2 text-xs"
        role="status"
        aria-label={`Data connection: ${connection.label}`}
      >
        <span aria-hidden className={`size-2 rounded-full ${TONE_DOT[connection.tone]}`} />
        <span className={connection.tone === "error" ? "font-medium text-fall" : "text-muted"}>
          {connection.label}
        </span>
      </span>
    </header>
  );
}

/** Display currency for portfolio amounts and converted prices (ADR 0013). */
function CurrencySelect() {
  const { selected, setCurrency, fx } = useCurrency();
  const codes =
    fx.status === "ready"
      ? Object.keys(fx.fx.rates).sort()
      : [...new Set([BASE_CURRENCY, selected])];
  const title =
    fx.status === "ready"
      ? `Display currency. Rates: ${fx.fx.source}, ${fx.fx.date}.`
      : fx.status === "error"
        ? fx.message
        : "Loading exchange rates…";

  return (
    <label
      className={`relative ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-subtle pr-2 pl-3 text-xs transition-colors duration-150 hover:text-text has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60 xl:ml-0 ${
        fx.status === "error" ? "text-fall" : "text-muted"
      }`}
      title={title}
    >
      <span className="sr-only">Display currency</span>
      <span aria-hidden className="font-medium text-text">
        {selected}
      </span>
      <CaretDownIcon aria-hidden size={12} weight="bold" />
      {/* The native list stays (keyboard, search-by-typing); only its closed face is custom. The
          open list takes the select's colours (Windows), so they must be the theme's, not inherited. */}
      <select
        value={selected}
        onChange={(event) => setCurrency(event.target.value)}
        className="absolute inset-0 cursor-pointer bg-panel text-text opacity-0 [&>option]:bg-panel [&>option]:text-text"
      >
        {codes.map((code) => (
          <option key={code} value={code}>
            {code} · {currencyName(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
