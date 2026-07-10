import { z } from "zod";
import { staffRecordSchema } from "./staffRecord.validation.js";

export const editStaffSchema = z.object({
  name: z
    .string({ message: "Name is required" })
    .min(2, "Name must be at least 2 characters")
    .optional(),
  email: staffRecordSchema.shape.email.unwrap()
    .transform((value) => value ?? null).nullable().optional(),
  phone: staffRecordSchema.shape.phone.optional(),
  shiftStart: z.coerce.date({ message: "Shift start must be a valid date" }).optional(),
  shiftEnd: z.coerce.date({ message: "Shift end must be a valid date" }).optional(),
  workDays: staffRecordSchema.shape.workDays,
}).superRefine((data, ctx) => {
  if (data.shiftStart !== undefined && data.shiftEnd !== undefined) {
    const startMin = data.shiftStart.getUTCHours() * 60 + data.shiftStart.getUTCMinutes();
    const endMin = data.shiftEnd.getUTCHours() * 60 + data.shiftEnd.getUTCMinutes();
    if (startMin === endMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Shift start and end cannot be the same time",
        path: ["shiftEnd"],
      });
    }
  }
});

export type EditStaffInput = z.infer<typeof editStaffSchema>;
