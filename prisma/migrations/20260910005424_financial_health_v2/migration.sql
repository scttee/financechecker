-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('INVESTMENT', 'SUPER', 'DEBT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProtectionKind" AS ENUM ('DEATH', 'TPD', 'INCOME_PROTECTION', 'HEALTH', 'BENEFICIARY');

-- CreateEnum
CREATE TYPE "AdminKind" AS ENUM ('TAX_RETURN', 'SUPER_REVIEW', 'INSURANCE_REVIEW', 'BENEFICIARY_REVIEW', 'RECURRING_COST_REVIEW', 'ANNUAL_REVIEW');

-- AlterEnum
ALTER TYPE "AiInsightKind" ADD VALUE 'HEALTH_SUMMARY';

-- AlterTable
ALTER TABLE "ExternalAsset" ADD COLUMN     "kind" "AssetKind" NOT NULL DEFAULT 'INVESTMENT';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "freedomRateTargetPct" INTEGER NOT NULL DEFAULT 25;

-- CreateTable
CREATE TABLE "FinancialHealthScoreSnapshot" (
    "id" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoreVersion" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "dimensions" JSONB NOT NULL,

    CONSTRAINT "FinancialHealthScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtectionItem" (
    "id" TEXT NOT NULL,
    "kind" "ProtectionKind" NOT NULL,
    "provider" TEXT,
    "coverCents" INTEGER,
    "premiumCents" INTEGER,
    "waitingPeriod" TEXT,
    "benefitPeriod" TEXT,
    "lastReviewed" TIMESTAMP(3),
    "nextReview" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminItem" (
    "id" TEXT NOT NULL,
    "kind" "AdminKind" NOT NULL,
    "lastCompleted" TIMESTAMP(3),
    "nextDue" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialHealthScoreSnapshot_takenAt_idx" ON "FinancialHealthScoreSnapshot"("takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProtectionItem_kind_key" ON "ProtectionItem"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "AdminItem_kind_key" ON "AdminItem"("kind");
