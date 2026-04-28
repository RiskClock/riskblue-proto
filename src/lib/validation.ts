import { z } from "zod";

/**
 * Authentication validation schemas
 */
export const authSchemas = {
  email: z
    .string()
    .trim()
    .email({ message: "Please enter a valid email address" })
    .max(255, { message: "Email must be less than 255 characters" }),
  
  password: z
    .string()
    .min(1, { message: "Password is required" })
    .max(128, { message: "Password must be less than 128 characters" }),
  
  displayName: z
    .string()
    .trim()
    .min(1, { message: "Name is required" })
    .max(100, { message: "Name must be less than 100 characters" })
    .regex(/^[a-zA-Z\s'-]+$/, { 
      message: "Name can only contain letters, spaces, hyphens, and apostrophes" 
    }),
};

export const signUpSchema = z.object({
  email: authSchemas.email,
  password: authSchemas.password,
  displayName: authSchemas.displayName,
});

export const signInSchema = z.object({
  email: authSchemas.email,
  password: authSchemas.password,
});

/**
 * Project validation schemas
 */
export const projectSchemas = {
  name: z
    .string()
    .trim()
    .min(1, { message: "Project name is required" })
    .max(200, { message: "Project name must be less than 200 characters" }),
  
  address: z
    .string()
    .trim()
    .max(200, { message: "Address must be less than 200 characters" })
    .optional(),
  
  city: z
    .string()
    .trim()
    .max(100, { message: "City must be less than 100 characters" })
    .optional(),
  
  state: z
    .string()
    .trim()
    .max(50, { message: "State must be less than 50 characters" })
    .optional(),
  
  zipCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, { message: "Please enter a valid ZIP code" })
    .optional()
    .or(z.literal("")),
  
  country: z
    .string()
    .trim()
    .max(100, { message: "Country must be less than 100 characters" })
    .optional(),
};

export const projectInfoSchema = z.object({
  projectName: projectSchemas.name,
  address1: projectSchemas.address,
  address2: projectSchemas.address,
  city: projectSchemas.city,
  state: projectSchemas.state,
  zipCode: projectSchemas.zipCode,
  country: projectSchemas.country,
  hasBuildersRiskPolicy: z.boolean(),
});
