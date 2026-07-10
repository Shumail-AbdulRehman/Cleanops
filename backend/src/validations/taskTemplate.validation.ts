import { z } from "zod";
import { repeatDaysSchema } from "../utils/workDays.js";

const taskBaseSchema = z.object({
  title: z.string({ message: "Title is required" }),
  description: z.string().optional(),
  locationId: z.number({ message: "Location is required" }).int(),
  shiftStart: z.coerce.date({ message: "Shift start is required" }),
  shiftEnd: z.coerce.date({ message: "Shift end is required" }),
  recurringType: z.enum(["DAILY", "ONCE"]).optional(),
  repeatDays: repeatDaysSchema.optional(),
  effectiveDate: z.coerce.date({ message: "Effective date is required" }),
  recurringEndDate: z.coerce.date().optional(),
});

export const createTaskMultipartSchema = z.object({
  title: z.string({ message: "Title is required" }),
  description: z.string().optional(),
  locationId: z.coerce.number({ message: "Location is required" }).int(),
  staffId: z.coerce.number().int().optional().or(z.literal("")).transform((v) =>
    v === "" ? undefined : v
  ),
  shiftStart: z.coerce.date({ message: "Shift start is required" }),
  shiftEnd: z.coerce.date({ message: "Shift end is required" }),
  recurringType: z.enum(["DAILY", "ONCE"]).optional(),
  repeatDays: repeatDaysSchema.optional(),
  effectiveDate: z.coerce.date({ message: "Effective date is required" }),
  recurringEndDate: z.coerce.date().optional().or(z.literal("")).transform((v) =>
    v === "" ? undefined : v
  ),
});

export const createTaskSchema = taskBaseSchema.superRefine((data, ctx) => {
  const now = new Date();
  const threeMinutesLater = new Date(now.getTime() + 3 * 60 * 1000);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (data.shiftEnd <= data.shiftStart) {
    ctx.addIssue({
      code: "custom",
      message: "Shift end must be after shift start",
      path: ["shiftEnd"],
    });
  }

  if (data.effectiveDate < todayStart) {
    ctx.addIssue({
      code: "custom",
      message: "Effective date cannot be in the past",
      path: ["effectiveDate"],
    });
  }

  if (data.shiftStart < threeMinutesLater) {
    ctx.addIssue({
      code: "custom",
      message: "Shift start must be at least 3 minutes from now",
      path: ["shiftStart"],
    });
  }
});



export const editTaskSchema = taskBaseSchema.partial().superRefine((data, ctx) => {

  if (data.shiftStart && data.shiftEnd) {
    if (data.shiftEnd <= data.shiftStart) {
      ctx.addIssue({
        code: "custom",
        message: "Shift end must be after shift start",
        path: ["shiftEnd"],
      });
    }
  }

});
