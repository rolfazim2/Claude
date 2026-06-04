-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "remindedDayBefore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remindedHourBefore" BOOLEAN NOT NULL DEFAULT false;
