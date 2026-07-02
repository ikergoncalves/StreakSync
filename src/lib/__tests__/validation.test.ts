import { forgotPasswordSchema, signInSchema, signUpSchema } from '../validation';

describe('signInSchema', () => {
  it('accepts a valid email and password', () => {
    const result = signInSchema.safeParse({ email: 'user@example.com', password: 'secret123' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = signInSchema.safeParse({ email: 'not-an-email', password: 'secret123' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = signInSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('signUpSchema', () => {
  const valid = { username: 'streak_fan42', email: 'user@example.com', password: 'longenough' };

  it('accepts valid input', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects passwords shorter than 8 characters', () => {
    const result = signUpSchema.safeParse({ ...valid, password: 'short12' });
    expect(result.success).toBe(false);
  });

  it.each(['ab', 'a'.repeat(21), 'UpperCase', 'has space', 'dash-name', 'émoji'])(
    'rejects invalid username %p',
    (username) => {
      expect(signUpSchema.safeParse({ ...valid, username }).success).toBe(false);
    },
  );

  it.each(['abc', 'a_1', 'user_name_20_chars__'])('accepts valid username %p', (username) => {
    expect(signUpSchema.safeParse({ ...valid, username }).success).toBe(true);
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
  });

  it('rejects a missing email', () => {
    expect(forgotPasswordSchema.safeParse({}).success).toBe(false);
  });
});
