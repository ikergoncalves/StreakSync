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

export const habitSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter a habit name')
      .max(100, 'Keep the name under 100 characters'),
    description: z.string().max(500, 'Keep the description under 500 characters'),
    icon: z.string().min(1, 'Pick an icon'),
    color: z.string().min(1, 'Pick a color'),
    frequency: z.enum(['daily', 'weekly']),
    targetDaysPerWeek: z
      .number()
      .int()
      .min(1, 'Choose between 1 and 7 days')
      .max(7, 'Choose between 1 and 7 days')
      .nullable(),
  })
  .refine((values) => values.frequency === 'daily' || values.targetDaysPerWeek !== null, {
    message: 'Choose how many days per week',
    path: ['targetDaysPerWeek'],
  });

export const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a group name')
    .max(50, 'Keep the name under 50 characters'),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type HabitFormInput = z.infer<typeof habitSchema>;
export type GroupFormInput = z.infer<typeof groupSchema>;
