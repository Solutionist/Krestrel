CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"shares" numeric(18, 6) NOT NULL,
	"price" numeric(14, 4) NOT NULL,
	"fee" numeric(14, 4) DEFAULT 0 NOT NULL,
	"traded_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_side_check" CHECK ("trades"."side" IN ('buy', 'sell')),
	CONSTRAINT "trades_shares_check" CHECK ("trades"."shares" > 0),
	CONSTRAINT "trades_price_check" CHECK ("trades"."price" >= 0),
	CONSTRAINT "trades_fee_check" CHECK ("trades"."fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_portfolio_symbol_idx" ON "trades" USING btree ("portfolio_id","symbol");