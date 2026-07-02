-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN "workDays" "Weekday"[] NOT NULL DEFAULT ARRAY['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']::"Weekday"[];

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN "repeatDays" "Weekday"[] NOT NULL DEFAULT ARRAY['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']::"Weekday"[];
