-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "strategyStatement" TEXT;

-- CreateTable
CREATE TABLE "WellbeingCheckin" (
    "id" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "control" INTEGER NOT NULL,
    "security" INTEGER NOT NULL,
    "freedom" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "shockAbsorption" INTEGER NOT NULL,
    "enjoyment" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "WellbeingCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WellbeingCheckin_takenAt_idx" ON "WellbeingCheckin"("takenAt");
