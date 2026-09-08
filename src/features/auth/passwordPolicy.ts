export const PASSWORD_MIN_LENGTH = 7;
export const PASSWORD_MAX_LENGTH = 16;
export const PASSWORD_LENGTH_HINT = '大于 6 位，最多 16 位';

export type PasswordStrength = {
  color: 'danger' | 'warning' | 'info' | 'success';
  label: '过短' | '过长' | '弱' | '一般' | '较强' | '强';
  score: 0 | 1 | 2 | 3 | 4;
};

export function isPasswordLengthValid(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

export function describePasswordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN_LENGTH) return { color: 'danger', label: '过短', score: 0 };
  if (password.length > PASSWORD_MAX_LENGTH) return { color: 'danger', label: '过长', score: 0 };

  const categoryCount = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  const score = Math.min(
    4,
    1
      + (password.length >= 10 ? 1 : 0)
      + (categoryCount >= 2 ? 1 : 0)
      + (categoryCount >= 3 ? 1 : 0),
  ) as PasswordStrength['score'];

  if (score <= 1) return { color: 'warning', label: '弱', score };
  if (score === 2) return { color: 'info', label: '一般', score };
  if (score === 3) return { color: 'success', label: '较强', score };
  return { color: 'success', label: '强', score };
}
