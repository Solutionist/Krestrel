CREATE TABLE "dividend_overrides" (
	"portfolio_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"ex_date" date NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dividend_overrides_portfolio_id_symbol_ex_date_pk" PRIMARY KEY("portfolio_id","symbol","ex_date"),
	CONSTRAINT "dividend_overrides_amount_check" CHECK ("dividend_overrides"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portfolio_targets" (
	"portfolio_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"weight" numeric(7, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_targets_portfolio_id_symbol_pk" PRIMARY KEY("portfolio_id","symbol"),
	CONSTRAINT "portfolio_targets_weight_check" CHECK ("portfolio_targets"."weight" > 0 AND "portfolio_targets"."weight" <= 100)
);
--> statement-breakpoint
ALTER TABLE "dividend_overrides" ADD CONSTRAINT "dividend_overrides_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_targets" ADD CONSTRAINT "portfolio_targets_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;