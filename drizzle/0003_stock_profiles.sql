CREATE TABLE "stock_profiles" (
	"symbol" text PRIMARY KEY NOT NULL,
	"sector" text,
	"style" text,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_profiles_source_check" CHECK ("stock_profiles"."source" IN ('model', 'owner')),
	CONSTRAINT "stock_profiles_style_check" CHECK ("stock_profiles"."style" IN ('growth', 'dividend', 'risky'))
);
