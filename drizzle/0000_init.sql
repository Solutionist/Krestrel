CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"price" numeric(14, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_at" timestamp with time zone,
	"trigger_price" numeric(14, 4),
	CONSTRAINT "alerts_direction_check" CHECK ("alerts"."direction" IN ('above', 'below'))
);
--> statement-breakpoint
CREATE TABLE "bars_1m" (
	"symbol" text NOT NULL,
	"source" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"open" numeric(14, 4) NOT NULL,
	"high" numeric(14, 4) NOT NULL,
	"low" numeric(14, 4) NOT NULL,
	"close" numeric(14, 4) NOT NULL,
	"volume" bigint NOT NULL,
	"trade_count" integer,
	"vwap" numeric(14, 4),
	CONSTRAINT "bars_1m_symbol_source_ts_pk" PRIMARY KEY("symbol","source","ts")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"symbol" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_symbol_watchlist_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."watchlist"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_active_symbol_idx" ON "alerts" USING btree ("symbol") WHERE "alerts"."active";