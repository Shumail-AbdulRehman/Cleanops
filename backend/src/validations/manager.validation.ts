import { z } from "zod";

export const managerSignupSchema = z.object({
  companyName: z
    .string({ message: "company name is required" })
  ,
  name: z
    .string({ message: "Name is required" })
    .min(2, "Name must be at least 2 characters"),


  email: z
    .string({ message: "Email is required" })
    .trim()
    .toLowerCase()
    .email("Invalid email format"),


  password: z
    .string({ message: "Password is required" })
    .min(8, "Password must be at least 8 characters")
    .refine(value => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes"),



});

export type ManagerSignupInput = z.infer<typeof managerSignupSchema>;

export const managerLoginSchema = z.object({
  email: z
    .string({ message: "Email is required" })
    .email("Invalid email format"),
  password: z
    .string({ message: "Password is required" })
    .min(1, "Password is required"),
});

export type ManagerLoginInput = z.infer<typeof managerLoginSchema>;

export const createManagerSchema = z.object({
  name: z
    .string({ message: "Name is required" })
    .min(2, "Name must be at least 2 characters"),

  email: z
    .string({ message: "Email is required" })
    .email("Invalid email format"),

  password: z
    .string({ message: "Password is required" })
    .min(6, "Password must be at least 6 characters"),

  locationIds: z
    .array(z.number().int().positive(), { message: "locationIds must be an array of location ids" })
    .min(1, "Assign at least one location"),
});

export type CreateManagerInput = z.infer<typeof createManagerSchema>;

export const updateManagerSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .optional(),

  email: z
    .string()
    .email("Invalid email format")
    .optional(),

  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .optional(),

  // Activation/deactivation is no longer supported.
  isActive: z.never().optional(),

  locationIds: z
    .array(z.number().int().positive())
    .min(1, "Assign at least one location")
    .optional(),
});

export type UpdateManagerInput = z.infer<typeof updateManagerSchema>;
