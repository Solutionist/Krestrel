CREATE TABLE "bars_1d" (
	"symbol" text NOT NULL,
	"source" text NOT NULL,
	"day" date NOT NULL,
	"open" numeric(14, 4) NOT NULL,
	"high" numeric(14, 4) NOT NULL,
	"low" numeric(14, 4) NOT NULL,
	"close" numeric(14, 4) NOT NULL,
	"volume" bigint NOT NULL,
	CONSTRAINT "bars_1d_symbol_source_day_pk" PRIMARY KEY("symbol","source","day")
);
