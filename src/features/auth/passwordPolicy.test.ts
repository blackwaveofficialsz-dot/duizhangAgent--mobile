import { describePasswordStrength, isPasswordLengthValid } from './passwordPolicy';

describe('passwordPolicy', () => {
  it('uses the seven to sixteen character password boundary', () => {
    expect(isPasswordLengthValid('abc123')).toBe(false);
    expect(isPasswordLengthValid('abc1234')).toBe(true);
    expect(isPasswordLengthValid('a'.repeat(17))).toBe(false);
  });

  it('grades password strength in visible steps', () => {
    expect(describePasswordStrength('abc1234')).toMatchObject({ label: '一般', score: 2 });
    expect(describePasswordStrength('Valid123')).toMatchObject({ label: '较强', score: 3 });
  });
});
