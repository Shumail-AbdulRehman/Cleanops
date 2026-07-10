import {z} from "zod";
import { isValidTimeZone } from "../utils/dateTime.js";


export const createLocationSchema = z.object({
  name: z
    .string({ message: "location name is required" }).trim().min(1, "Location name is required").max(200),
  address: z
    .string({ message: "location address is required" }).trim().min(1, "Location address is required").max(1000),
  latitude: z
    .string({ message: "latitude is required" })
    .trim().min(1, "Latitude is required").refine((v) => {
      const n = Number(v);
      return !isNaN(n) && n >= -90 && n <= 90;
    }, "Latitude must be a number between -90 and 90"),
  longitude: z
    .string({ message: "longitude is required" })
    .trim().min(1, "Longitude is required").refine((v) => {
      const n = Number(v);
      return !isNaN(n) && n >= -180 && n <= 180;
    }, "Longitude must be a number between -180 and 180"),
  radiusMeters: z.number().int().min(25, "Attendance radius must be at least 25 m").max(5000, "Attendance radius must be at most 5,000 m").optional(),
  timezone: z
    .string()
    .refine(isValidTimeZone, "Invalid timezone")
    .optional()

})

export const editLocationSchema = createLocationSchema.extend({
  timezone: createLocationSchema.shape.timezone.optional()
})

export type createLocationInput = z.infer<typeof createLocationSchema>;
export type editLocationInput = z.infer<typeof editLocationSchema>;
