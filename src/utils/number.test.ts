import { amountToCents, sumAmounts } from './number';

describe('financial amount helpers', () => {
  it('rounds number and string inputs to cents with halves away from zero', () => {
    expect(amountToCents(1.005)).toBe(101);
    expect(amountToCents('-1.005')).toBe(-101);
    expect(amountToCents('0.004')).toBe(0);
    expect(amountToCents('5e-3')).toBe(1);
  });

  it('sums financial values as integer cents', () => {
    expect(sumAmounts([0.1, '0.2', -0.05, '10.01'])).toBe(10.26);
  });
});
