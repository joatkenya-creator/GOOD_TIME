import { z } from 'zod';

/**
 * Auth input contracts.
 *
 * These are the single source of truth for both the React Hook Form resolver on
 * the client and the server action / route handler on the server. One schema, two
 * consumers — client validation can never drift from what the server enforces.
 */

const email = z.email('Enter a valid email address.').max(254).trim().toLowerCase();

/**
 * Password policy: length over composition rules. NIST SP 800-63B guidance —
 * forcing a symbol and a digit produces `Password1!`, not entropy.
 */
const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Passwords cannot exceed 128 characters.');

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
  redirectTo: z.string().optional(),
});

export const registerSchema = z
  .object({
    firstName: z.string().min(1, 'Enter your first name.').max(60).trim(),
    lastName: z.string().min(1, 'Enter your last name.').max(60).trim(),
    email,
    password,
    confirmPassword: z.string(),
    acceptsMarketing: z.boolean().default(false),
    acceptsTerms: z.literal(true, {
      error: 'You must accept the terms to create an account.',
    }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const verifyEmailSchema = z.object({ token: z.string().min(1) });

export type SignInInput = z.infer<typeof signInSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
