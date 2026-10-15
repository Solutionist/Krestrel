import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("ideas", "routes/ideas.tsx"),
  route("portfolio", "routes/portfolio.tsx"),
  route("api/stream", "routes/api.stream.ts"),
  route("api/assets", "routes/api.assets.ts"),
  route("api/bars/:symbol", "routes/api.bars.$symbol.ts"),
  route("api/outlook/:symbol", "routes/api.outlook.$symbol.ts"),
  route("api/ideas", "routes/api.ideas.ts"),
  route("api/watchlist", "routes/api.watchlist.ts"),
  route("api/portfolios", "routes/api.portfolios.ts"),
  route("api/portfolio-import", "routes/api.portfolio-import.ts"),
  route("api/stock-profiles", "routes/api.stock-profiles.ts"),
  route("api/ai", "routes/api.ai.ts"),
  route("api/fx", "routes/api.fx.ts"),
  route("api/dividends", "routes/api.dividends.ts"),
  route("api/signals", "routes/api.signals.ts"),
  route("api/health", "routes/api.health.ts"),
  route("ocr/:file", "routes/ocr.$file.ts"),
] satisfies RouteConfig;
