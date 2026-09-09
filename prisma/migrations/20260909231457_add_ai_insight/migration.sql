-- CreateEnum
CREATE TYPE "AiInsightKind" AS ENUM ('TODAY_HEADLINE', 'REVIEW_WEEK', 'REVIEW_MONTH', 'REVIEW_SIX_MONTHS');

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL,
    "kind" "AiInsightKind" NOT NULL,
    "headline" TEXT,
    "detail" TEXT,
    "narrative" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiInsight_kind_key" ON "AiInsight"("kind");
