import { z } from "zod";

// Multipart coordinates are decimal strings; reject blank/null/boolean/array
// coercions, which otherwise silently turn missing geography into zero.
const numericCoordinate = z.union([
  z.number(),
  z.string().trim().min(1).regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/),
]).transform(Number);
const geography = {
  latitude: numericCoordinate.pipe(z.number().finite().min(-90).max(90)),
  longitude: numericCoordinate.pipe(z.number().finite().min(-180).max(180)),
  accuracy: numericCoordinate.pipe(z.number().finite().min(0).max(200, "Wait for location accuracy of 200 metres or better")).optional(),
};
export const checkInSchema = z.object(geography);
export type CheckInInput = z.infer<typeof checkInSchema>;
export const checkOutSchema = z.object({
  ...geography,
  attendanceId: numericCoordinate.pipe(z.number().int().positive()).optional(),
});
export type CheckOutInput = z.infer<typeof checkOutSchema>;

export const assignShiftSchema = z.object({
        shiftStart: z.coerce.date({ message: "Shift start time is required" }),
        shiftEnd: z.coerce.date({ message: "Shift end time is required" }),
    })
    .superRefine((data, ctx) => {
        const startHours = data.shiftStart.getUTCHours() * 60 + data.shiftStart.getUTCMinutes();
        const endHours = data.shiftEnd.getUTCHours() * 60 + data.shiftEnd.getUTCMinutes();

        if (startHours === endHours) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Shift start and end cannot be the same time",
                path: ["shiftEnd"],
            });
        }
    });

export type AssignShiftInput = z.infer<typeof assignShiftSchema>;
