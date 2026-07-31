-- CreateEnum
CREATE TYPE "ProductRelationType" AS ENUM ('RELATED', 'FREQUENTLY_BOUGHT_TOGETHER', 'UPSELL', 'CROSS_SELL');

-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'ENUM');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "heroBody" TEXT,
ADD COLUMN     "heroHeadline" TEXT;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "tags",
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "facets" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isNewArrival" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isOnSale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "primaryCategoryId" TEXT,
ADD COLUMN     "returnPolicyNote" TEXT,
ADD COLUMN     "shippingNote" TEXT,
ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "soldCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tags" ADD COLUMN     "isFilterable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "variants" ADD COLUMN     "diameterMm" INTEGER,
ADD COLUMN     "heightMm" INTEGER,
ADD COLUMN     "insertableLengthMm" INTEGER,
ADD COLUMN     "lengthMm" INTEGER,
ADD COLUMN     "salePriceCents" INTEGER,
ADD COLUMN     "widthMm" INTEGER;

-- CreateTable
CREATE TABLE "review_images" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "alt" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_votes" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isHelpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_votes_pkey" PRIMARY KEY ("reviewId","userId")
);

-- CreateTable
CREATE TABLE "attribute_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL DEFAULT 'TEXT',
    "unit" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isFilterable" BOOLEAN NOT NULL DEFAULT false,
    "isSpec" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "productId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("productId","definitionId")
);

-- CreateTable
CREATE TABLE "product_relations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "relatedId" TEXT NOT NULL,
    "type" "ProductRelationType" NOT NULL DEFAULT 'RELATED',
    "position" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recently_viewed" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateTable
CREATE TABLE "product_search_documents" (
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brandName" TEXT,
    "categoryPath" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_search_documents_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "search_queries" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "review_images_reviewId_position_idx" ON "review_images"("reviewId", "position");

-- CreateIndex
CREATE INDEX "review_votes_userId_idx" ON "review_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_definitions_key_key" ON "attribute_definitions"("key");

-- CreateIndex
CREATE INDEX "attribute_definitions_isFilterable_idx" ON "attribute_definitions"("isFilterable");

-- CreateIndex
CREATE INDEX "attribute_definitions_group_position_idx" ON "attribute_definitions"("group", "position");

-- CreateIndex
CREATE INDEX "product_attributes_definitionId_value_idx" ON "product_attributes"("definitionId", "value");

-- CreateIndex
CREATE INDEX "product_relations_productId_type_position_idx" ON "product_relations"("productId", "type", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_relations_productId_relatedId_type_key" ON "product_relations"("productId", "relatedId", "type");

-- CreateIndex
CREATE INDEX "recently_viewed_userId_viewedAt_idx" ON "recently_viewed"("userId", "viewedAt");

-- CreateIndex
CREATE INDEX "search_queries_term_createdAt_idx" ON "search_queries"("term", "createdAt");

-- CreateIndex
CREATE INDEX "search_queries_createdAt_idx" ON "search_queries"("createdAt");

-- CreateIndex
CREATE INDEX "search_queries_resultCount_createdAt_idx" ON "search_queries"("resultCount", "createdAt");

-- CreateIndex
CREATE INDEX "_ProductToTag_B_index" ON "_ProductToTag"("B");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_status_soldCount_idx" ON "products"("status", "soldCount");

-- CreateIndex
CREATE INDEX "products_isOnSale_status_idx" ON "products"("isOnSale", "status");

-- CreateIndex
CREATE INDEX "products_isNewArrival_status_idx" ON "products"("isNewArrival", "status");

-- CreateIndex
CREATE INDEX "products_primaryCategoryId_idx" ON "products"("primaryCategoryId");

-- CreateIndex
CREATE INDEX "products_facets_idx" ON "products" USING GIN ("facets");

-- CreateIndex
CREATE INDEX "reviews_productId_status_helpfulCount_idx" ON "reviews"("productId", "status", "helpfulCount");

-- CreateIndex
CREATE INDEX "reviews_productId_status_rating_idx" ON "reviews"("productId", "status", "rating");

-- CreateIndex
CREATE INDEX "tags_isFilterable_idx" ON "tags"("isFilterable");

-- CreateIndex
CREATE INDEX "variants_isActive_salePriceCents_idx" ON "variants"("isActive", "salePriceCents");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_primaryCategoryId_fkey" FOREIGN KEY ("primaryCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "attribute_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_relatedId_fkey" FOREIGN KEY ("relatedId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed" ADD CONSTRAINT "recently_viewed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed" ADD CONSTRAINT "recently_viewed_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_search_documents" ADD CONSTRAINT "product_search_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToTag" ADD CONSTRAINT "_ProductToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToTag" ADD CONSTRAINT "_ProductToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written additions
--
-- Everything below is beyond what the Prisma schema language can express:
-- functional indexes, extensions and check constraints. Prisma regenerates the
-- section above from the datamodel; this section is maintained by hand.
-- ===========================================================================

-- --- Full-text and fuzzy search ------------------------------------------
-- Trigram matching, so "vibrater" and "vibratr" still find "vibrator". Without
-- this, a typo returns an empty result set and the visitor leaves.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Primary full-text index. A functional GIN index over the generated tsvector:
-- one index scan for any word combination, and it stays correct as content
-- changes because the expression is evaluated on write.
CREATE INDEX "product_search_documents_content_fts_idx"
  ON "product_search_documents"
  USING GIN (to_tsvector('english', "content"));

-- Fuzzy fallback for the typo path and for prefix-style autocomplete.
CREATE INDEX "product_search_documents_title_trgm_idx"
  ON "product_search_documents"
  USING GIN ("title" gin_trgm_ops);

-- Prefix search on product names for the header typeahead, which hits products
-- directly rather than the search document.
CREATE INDEX "products_name_trgm_idx"
  ON "products"
  USING GIN ("name" gin_trgm_ops);

-- --- Data integrity ------------------------------------------------------
-- The application validates all of these, but a constraint is what survives a
-- bad migration, a careless SQL console session or a future import bug.

-- Ratings are 1-5. Referenced by the comment on Review.rating in schema.prisma.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- Money is unsigned. A negative price is a free product; a negative sale price
-- is a payout.
ALTER TABLE "variants"
  ADD CONSTRAINT "variants_price_non_negative" CHECK ("priceCents" >= 0),
  ADD CONSTRAINT "variants_sale_price_non_negative"
    CHECK ("salePriceCents" IS NULL OR "salePriceCents" >= 0),
  -- A "sale" price above the list price is a merchandising error, not a sale.
  ADD CONSTRAINT "variants_sale_below_list"
    CHECK ("salePriceCents" IS NULL OR "salePriceCents" <= "priceCents");

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_range_ordered" CHECK ("maxPriceCents" >= "minPriceCents"),
  ADD CONSTRAINT "products_rating_average_range" CHECK ("ratingAverage" BETWEEN 0 AND 5);

-- Stock cannot be negative, and reservations cannot exceed what exists.
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_quantity_non_negative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "inventory_reserved_within_quantity"
    CHECK ("reserved" >= 0 AND "reserved" <= "quantity");

-- A product cannot be related to itself.
ALTER TABLE "product_relations"
  ADD CONSTRAINT "product_relations_no_self_reference" CHECK ("productId" <> "relatedId");

-- --- Partial indexes -----------------------------------------------------
-- The storefront only ever reads live products, so index only those rows. At
-- 100k products with a large archived tail this is materially smaller and
-- faster than the equivalent full index.
CREATE INDEX "products_live_published_idx"
  ON "products" ("publishedAt" DESC)
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

CREATE INDEX "products_live_price_idx"
  ON "products" ("minPriceCents")
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;
