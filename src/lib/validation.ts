import { z } from 'zod';

const email = z.email('Enter a valid email address');

const password = z.string().min(8, 'Password must be at least 8 characters');

export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-z0-9_]+$/, 'Use only lowercase letters, numbers, and underscores');

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

export const signUpSchema = z.object({
  username: usernameSchema,
  email,
  password,
});

export const forgotPasswordSchema = z.object({
  email,
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
