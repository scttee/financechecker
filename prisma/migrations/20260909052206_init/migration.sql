-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('SPENDING', 'RENT', 'BILLS', 'HEALTH_THERAPY', 'GROCERIES', 'DINING_SOCIAL', 'FUN', 'TRANSPORT', 'TRAVEL', 'GEAR_OBJECTS', 'EMERGENCY', 'FUTURE_OPTIONS', 'BUFFER', 'INVESTING', 'OTHER');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('PHASE_1', 'PHASE_2');

-- CreateEnum
CREATE TYPE "SalaryCadence" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('CONTAINS', 'EXACT', 'REGEX');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('HELD', 'SETTLED');

-- CreateEnum
CREATE TYPE "RoleSource" AS ENUM ('UNRESOLVED', 'ACCOUNT', 'MERCHANT_RULE', 'UP_CATEGORY', 'TAG', 'MANUAL');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('UP', 'LOCAL', 'SUGGESTED');

-- CreateEnum
CREATE TYPE "AutoTagMode" AS ENUM ('DRY_RUN', 'APPLY_LOCAL', 'APPLY_TO_UP');

-- CreateEnum
CREATE TYPE "WishlistSource" AS ENUM ('NOTION', 'LOCAL');

-- CreateEnum
CREATE TYPE "WishlistStatus" AS ENUM ('CONSIDERING', 'ORDERED', 'BOUGHT', 'DECLINED', 'PARKED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('SAFETY_REPLACEMENT', 'REPLACEMENT', 'NEED', 'USEFUL_UPGRADE', 'WANT', 'FUTURE_DECISION');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('BUY', 'WAIT', 'NOT_FUNDED', 'NEEDS_INFORMATION');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('NEW', 'EXPECTED', 'CANCELLED', 'NOT_RECURRING', 'REVIEW');

-- CreateEnum
CREATE TYPE "LeakageVerdict" AS ENUM ('UNREVIEWED', 'EXPECTED', 'LEGITIMATE_EXCEPTION', 'NOT_RELATED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ReviewItemKind" AS ENUM ('EMERGENCY_TRANSFER_OUT', 'FUTURE_OPTIONS_TRANSFER_OUT', 'POSSIBLE_LEAKAGE', 'NEW_RECURRING_COST', 'CATEGORY_RUNNING_HOT', 'EMERGENCY_TARGET_REACHED', 'PHASE_CHANGED', 'WISHLIST_ITEM_FUNDED', 'SYNC_PROBLEM', 'SETUP_INCOMPLETE');

-- CreateEnum
CREATE TYPE "ReviewItemSeverity" AS ENUM ('INFO', 'WORTH_NOTICING', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('MANUAL', 'HISTORICAL_IMPORT', 'WEBHOOK', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "rentCents" INTEGER NOT NULL DEFAULT 134000,
    "emergencyTargetCents" INTEGER NOT NULL DEFAULT 1200000,
    "futureOptionsTargetCents" INTEGER NOT NULL DEFAULT 1000000,
    "typicalSalaryCents" INTEGER NOT NULL DEFAULT 438031,
    "salaryCadence" "SalaryCadence" NOT NULL DEFAULT 'FORTNIGHTLY',
    "salaryMinCents" INTEGER NOT NULL DEFAULT 200000,
    "runningHotDeltaPct" INTEGER NOT NULL DEFAULT 15,
    "nearLimitRemainingPct" INTEGER NOT NULL DEFAULT 15,
    "essentialLeewayPct" INTEGER NOT NULL DEFAULT 10,
    "leakageWindowMinutes" INTEGER NOT NULL DEFAULT 180,
    "leakageTolerancePct" INTEGER NOT NULL DEFAULT 30,
    "leakageMinCents" INTEGER NOT NULL DEFAULT 5000,
    "waitTier1MaxCents" INTEGER NOT NULL DEFAULT 5000,
    "waitTier2MaxCents" INTEGER NOT NULL DEFAULT 20000,
    "waitTier3MaxCents" INTEGER NOT NULL DEFAULT 50000,
    "waitTier1Hours" INTEGER NOT NULL DEFAULT 0,
    "waitTier2Hours" INTEGER NOT NULL DEFAULT 72,
    "waitTier3Hours" INTEGER NOT NULL DEFAULT 336,
    "waitTier4Hours" INTEGER NOT NULL DEFAULT 720,
    "recurringMinOccurrences" INTEGER NOT NULL DEFAULT 3,
    "recurringMinConfidence" INTEGER NOT NULL DEFAULT 60,
    "autoTagMode" "AutoTagMode" NOT NULL DEFAULT 'DRY_RUN',
    "historicalImportMonths" INTEGER NOT NULL DEFAULT 6,
    "phase" "Phase" NOT NULL DEFAULT 'PHASE_1',
    "phaseChangedAt" TIMESTAMP(3),
    "emergencyReachedAt" TIMESTAMP(3),
    "setupCompletedAt" TIMESTAMP(3),
    "notionLastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationPercent" (
    "id" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "role" "AccountRole" NOT NULL,
    "basisPoints" INTEGER NOT NULL,

    CONSTRAINT "AllocationPercent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL DEFAULT 'CONTAINS',
    "minCents" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "ownershipType" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRoleMapping" (
    "accountId" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL,
    "displayName" TEXT,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "isDiscretionary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountRoleMapping_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "status" "TxStatus" NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rawText" TEXT,
    "message" TEXT,
    "amountCents" INTEGER NOT NULL,
    "heldAmountCents" INTEGER,
    "foreignAmountCents" INTEGER,
    "foreignCurrency" TEXT,
    "roundUpCents" INTEGER,
    "cashbackCents" INTEGER,
    "isCategorizable" BOOLEAN NOT NULL DEFAULT true,
    "transactionType" TEXT,
    "cardSuffix" TEXT,
    "upCategoryId" TEXT,
    "upParentCategoryId" TEXT,
    "transferAccountId" TEXT,
    "isInternalTransfer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "payCycleId" TEXT,
    "role" "AccountRole",
    "roleSource" "RoleSource" NOT NULL DEFAULT 'UNRESOLVED',
    "isSalary" BOOLEAN NOT NULL DEFAULT false,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionTag" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "source" "TagSource" NOT NULL DEFAULT 'UP',
    "appliedToUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRule" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL DEFAULT 'CONTAINS',
    "role" "AccountRole",
    "tag" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayCycle" (
    "id" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "endIsProjected" BOOLEAN NOT NULL DEFAULT true,
    "salaryTransactionId" TEXT,
    "incomeCents" INTEGER NOT NULL,
    "rentCents" INTEGER NOT NULL,
    "allocatableCents" INTEGER NOT NULL,
    "phase" "Phase" NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetAllocation" (
    "id" TEXT NOT NULL,
    "payCycleId" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    "allocatedCents" INTEGER NOT NULL,

    CONSTRAINT "BudgetAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialGoal" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL,
    "targetCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isHardFloor" BOOLEAN NOT NULL DEFAULT false,
    "reachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAsset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAssetSnapshot" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalAssetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "source" "WishlistSource" NOT NULL DEFAULT 'LOCAL',
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER,
    "rawPrice" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'WANT',
    "status" "WishlistStatus" NOT NULL DEFAULT 'CONSIDERING',
    "role" "AccountRole" NOT NULL DEFAULT 'GEAR_OBJECTS',
    "notes" TEXT,
    "url" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDecision" (
    "id" TEXT NOT NULL,
    "wishlistItemId" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "saverBalanceCents" INTEGER NOT NULL,
    "priceCents" INTEGER,
    "checks" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringMerchant" (
    "id" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "typicalAmountCents" INTEGER NOT NULL,
    "monthlyEquivalentCents" INTEGER NOT NULL,
    "occurrences" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "nextExpectedAt" TIMESTAMP(3),
    "confidence" INTEGER NOT NULL,
    "status" "RecurringStatus" NOT NULL DEFAULT 'NEW',
    "acknowledgedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringMerchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeakageEvent" (
    "id" TEXT NOT NULL,
    "transferTransactionId" TEXT NOT NULL,
    "transferAt" TIMESTAMP(3) NOT NULL,
    "transferCents" INTEGER NOT NULL,
    "sourceRole" "AccountRole" NOT NULL,
    "destRole" "AccountRole",
    "spendTransactionIds" TEXT[],
    "spendCents" INTEGER NOT NULL,
    "spendRole" "AccountRole",
    "minutesBetween" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "explanation" JSONB NOT NULL,
    "verdict" "LeakageVerdict" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeakageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "kind" "ReviewItemKind" NOT NULL,
    "severity" "ReviewItemSeverity" NOT NULL DEFAULT 'WORTH_NOTICING',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "transactionId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "accountsSynced" INTEGER NOT NULL DEFAULT 0,
    "transactionsSeen" INTEGER NOT NULL DEFAULT 0,
    "transactionsCreated" INTEGER NOT NULL DEFAULT 0,
    "transactionsUpdated" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "since" TEXT,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllocationPercent_phase_idx" ON "AllocationPercent"("phase");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationPercent_phase_role_key" ON "AllocationPercent"("phase", "role");

-- CreateIndex
CREATE INDEX "SalaryRule_enabled_priority_idx" ON "SalaryRule"("enabled", "priority");

-- CreateIndex
CREATE INDEX "AccountRoleMapping_role_idx" ON "AccountRoleMapping"("role");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_accountId_createdAt_idx" ON "Transaction"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_payCycleId_idx" ON "Transaction"("payCycleId");

-- CreateIndex
CREATE INDEX "Transaction_role_idx" ON "Transaction"("role");

-- CreateIndex
CREATE INDEX "Transaction_isInternalTransfer_createdAt_idx" ON "Transaction"("isInternalTransfer", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_isSalary_createdAt_idx" ON "Transaction"("isSalary", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_deletedAt_idx" ON "Transaction"("deletedAt");

-- CreateIndex
CREATE INDEX "TransactionTag_tag_idx" ON "TransactionTag"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionTag_transactionId_tag_key" ON "TransactionTag"("transactionId", "tag");

-- CreateIndex
CREATE INDEX "MerchantRule_enabled_priority_idx" ON "MerchantRule"("enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "PayCycle_salaryTransactionId_key" ON "PayCycle"("salaryTransactionId");

-- CreateIndex
CREATE INDEX "PayCycle_startAt_idx" ON "PayCycle"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetAllocation_payCycleId_role_key" ON "BudgetAllocation"("payCycleId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialGoal_key_key" ON "FinancialGoal"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAsset_key_key" ON "ExternalAsset"("key");

-- CreateIndex
CREATE INDEX "ExternalAssetSnapshot_assetId_takenAt_idx" ON "ExternalAssetSnapshot"("assetId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAssetSnapshot_assetId_takenAt_key" ON "ExternalAssetSnapshot"("assetId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_externalId_key" ON "WishlistItem"("externalId");

-- CreateIndex
CREATE INDEX "WishlistItem_archived_status_idx" ON "WishlistItem"("archived", "status");

-- CreateIndex
CREATE INDEX "PurchaseDecision_wishlistItemId_decidedAt_idx" ON "PurchaseDecision"("wishlistItemId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringMerchant_merchantKey_key" ON "RecurringMerchant"("merchantKey");

-- CreateIndex
CREATE INDEX "RecurringMerchant_status_idx" ON "RecurringMerchant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeakageEvent_transferTransactionId_key" ON "LeakageEvent"("transferTransactionId");

-- CreateIndex
CREATE INDEX "LeakageEvent_verdict_transferAt_idx" ON "LeakageEvent"("verdict", "transferAt");

-- CreateIndex
CREATE INDEX "LeakageEvent_transferAt_idx" ON "LeakageEvent"("transferAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewItem_dedupeKey_key" ON "ReviewItem"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReviewItem_dismissedAt_createdAt_idx" ON "ReviewItem"("dismissedAt", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "AccountRoleMapping" ADD CONSTRAINT "AccountRoleMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_transferAccountId_fkey" FOREIGN KEY ("transferAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payCycleId_fkey" FOREIGN KEY ("payCycleId") REFERENCES "PayCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionTag" ADD CONSTRAINT "TransactionTag_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_payCycleId_fkey" FOREIGN KEY ("payCycleId") REFERENCES "PayCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAssetSnapshot" ADD CONSTRAINT "ExternalAssetSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ExternalAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDecision" ADD CONSTRAINT "PurchaseDecision_wishlistItemId_fkey" FOREIGN KEY ("wishlistItemId") REFERENCES "WishlistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
