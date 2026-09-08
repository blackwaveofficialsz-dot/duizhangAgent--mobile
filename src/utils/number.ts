const amountFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

export type AmountValue = number | string | null | undefined;

export function amountToCents(value: AmountValue): number {
  const raw = String(value ?? '').trim().replace(/,/g, '');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match || (!match[2] && !match[3])) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] ?? '';
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  const digits = `${whole}${fraction}`;
  const centsPosition = whole.length + exponent + 2;

  let cents = 0;
  let roundDigit = '0';
  if (centsPosition <= 0) {
    roundDigit = centsPosition === 0 ? digits[0] ?? '0' : '0';
  } else {
    cents = Number(digits.slice(0, centsPosition).padEnd(centsPosition, '0') || 0);
    roundDigit = digits[centsPosition] ?? '0';
  }
  if (roundDigit >= '5') cents += 1;

  return cents === 0 ? 0 : sign * cents;
}

export function sumAmounts(values: Iterable<AmountValue>): number {
  let cents = 0;
  for (const value of values) cents += amountToCents(value);
  return cents / 100;
}

export function formatAmount(value: number | null | undefined): string {
  return amountFormatter.format(Number(value) || 0);
}

export function formatCount(value: number | null | undefined): string {
  return integerFormatter.format(Number(value) || 0);
}

export function formatPercent(value: number | null | undefined): string {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}
