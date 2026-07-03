/** Giá trị lớn nhất của numeric(18,2), biểu diễn theo đơn vị nhỏ nhất. */
export const MAX_MONEY_MINOR_UNITS = 999999999999999999n;

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

/** Chuyển decimal hợp lệ sang số nguyên đơn vị nhỏ nhất để tính toán chính xác. */
export function moneyToMinorUnits(value: string): bigint {
  if (!MONEY_PATTERN.test(value)) {
    throw new Error('Định dạng tiền không hợp lệ');
  }

  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** Chuyển số nguyên đơn vị nhỏ nhất về decimal chuẩn để ghi vào PostgreSQL. */
export function minorUnitsToMoney(value: bigint): string {
  if (value < 0n || value > MAX_MONEY_MINOR_UNITS) {
    throw new Error('Giá trị tiền nằm ngoài numeric(18,2)');
  }

  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

export function normalizeMoney(value: string): string {
  return minorUnitsToMoney(moneyToMinorUnits(value));
}
