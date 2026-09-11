CREATE TABLE "CareerBreakPlan" (
  "id" TEXT NOT NULL DEFAULT 'personal',
  "startDate" TEXT NOT NULL,
  "durationMonths" INTEGER NOT NULL,
  "monthlyCostCents" INTEGER NOT NULL,
  "perCycleCents" INTEGER NOT NULL,
  "upfrontCents" INTEGER NOT NULL,
  "bufferMonths" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareerBreakPlan_pkey" PRIMARY KEY ("id")
);
