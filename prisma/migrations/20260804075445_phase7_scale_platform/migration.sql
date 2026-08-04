-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowOutcome" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED', 'FAILED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "SeoIssueSeverity" AS ENUM ('CRITICAL', 'WARNING', 'NOTICE');

-- CreateEnum
CREATE TYPE "MarketingProvider" AS ENUM ('GA4', 'GTM', 'GOOGLE_ADS', 'GOOGLE_MERCHANT', 'GOOGLE_SEARCH_CONSOLE', 'META_PIXEL', 'TIKTOK_PIXEL', 'PINTEREST_TAG', 'MICROSOFT_UET', 'LINKEDIN_INSIGHT');

-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "isDryRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rolledBackAt" TIMESTAMP(3),
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "dedupeKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scheduleId" TEXT,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "cron" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" "JobStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "ImportSourceType" NOT NULL,
    "mapping" JSONB NOT NULL,
    "defaults" JSONB,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "outcome" "ImportRowOutcome" NOT NULL,
    "externalId" TEXT,
    "sku" TEXT,
    "productId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "orderId" TEXT,
    "searchTerm" TEXT,
    "valueCents" INTEGER,
    "quantity" INTEGER,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "device" TEXT,
    "country" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "dimension" TEXT,
    "value" INTEGER NOT NULL DEFAULT 0,
    "valueCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_audits" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "checked" INTEGER NOT NULL DEFAULT 0,
    "critical" INTEGER NOT NULL DEFAULT 0,
    "warnings" INTEGER NOT NULL DEFAULT 0,
    "notices" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,

    CONSTRAINT "seo_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_issues" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "severity" "SeoIssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_integrations" (
    "id" TEXT NOT NULL,
    "provider" "MarketingProvider" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicId" TEXT,
    "config" JSONB,
    "requiresConsent" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_synonyms" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isOneWay" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_optimization_logs" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "originalBytes" INTEGER,
    "optimizedBytes" INTEGER,
    "format" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_optimization_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_dedupeKey_key" ON "background_jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "background_jobs_status_runAt_priority_idx" ON "background_jobs"("status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "background_jobs_kind_status_idx" ON "background_jobs"("kind", "status");

-- CreateIndex
CREATE INDEX "background_jobs_lockedAt_idx" ON "background_jobs"("lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_key_key" ON "scheduled_jobs"("key");

-- CreateIndex
CREATE INDEX "scheduled_jobs_isActive_nextRunAt_idx" ON "scheduled_jobs"("isActive", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_name_sourceType_key" ON "import_templates"("name", "sourceType");

-- CreateIndex
CREATE INDEX "import_rows_jobId_outcome_idx" ON "import_rows"("jobId", "outcome");

-- CreateIndex
CREATE INDEX "import_rows_jobId_rowNumber_idx" ON "import_rows"("jobId", "rowNumber");

-- CreateIndex
CREATE INDEX "import_rows_externalId_idx" ON "import_rows"("externalId");

-- CreateIndex
CREATE INDEX "analytics_events_name_createdAt_idx" ON "analytics_events"("name", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_sessionId_createdAt_idx" ON "analytics_events"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_productId_name_createdAt_idx" ON "analytics_events"("productId", "name", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_createdAt_idx" ON "analytics_events"("createdAt");

-- CreateIndex
CREATE INDEX "analytics_daily_metric_day_idx" ON "analytics_daily"("metric", "day");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_daily_day_metric_dimension_key" ON "analytics_daily"("day", "metric", "dimension");

-- CreateIndex
CREATE INDEX "seo_audits_startedAt_idx" ON "seo_audits"("startedAt");

-- CreateIndex
CREATE INDEX "seo_issues_auditId_severity_idx" ON "seo_issues"("auditId", "severity");

-- CreateIndex
CREATE INDEX "seo_issues_code_resolvedAt_idx" ON "seo_issues"("code", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_integrations_provider_key" ON "marketing_integrations"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "search_synonyms_term_key" ON "search_synonyms"("term");

-- CreateIndex
CREATE INDEX "media_optimization_logs_mediaId_createdAt_idx" ON "media_optimization_logs"("mediaId", "createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_templateId_idx" ON "import_jobs"("templateId");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "import_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "scheduled_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "seo_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_integrations" ADD CONSTRAINT "marketing_integrations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_optimization_logs" ADD CONSTRAINT "media_optimization_logs_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants the application must not be the only thing enforcing.

-- A job cannot promise more attempts than it allows itself.
ALTER TABLE "background_jobs"
  ADD CONSTRAINT "background_jobs_attempts_sane"
  CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts" + 1);

-- Import counters are counts, never negative.
ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_counts_non_negative"
  CHECK ("totalRows" >= 0 AND "processedRows" >= 0 AND "failedRows" >= 0);

-- Analytics money is cents and never negative; a refund is its own event.
ALTER TABLE "analytics_events"
  ADD CONSTRAINT "analytics_events_value_non_negative"
  CHECK ("valueCents" IS NULL OR "valueCents" >= 0);

-- The claim query reads only eligible rows; a partial index keeps it small
-- even when millions of finished jobs sit in the table.
CREATE INDEX "background_jobs_claimable_idx"
  ON "background_jobs" ("priority", "runAt")
  WHERE "status" = 'QUEUED';

-- Trending searches scan a 24-hour window, not the whole history.
CREATE INDEX "analytics_events_recent_idx"
  ON "analytics_events" ("name", "createdAt" DESC);
