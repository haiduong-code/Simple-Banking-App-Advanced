const MONEY_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

export function normalizeMoneyInput(value: string): string {
  return value.trim().replace(',', '.');
}

export function isValidMoney(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

export function moneyToMinorUnits(value: string): bigint {
  const normalized = normalizeMoneyInput(value);
  if (!isValidMoney(normalized)) {
    throw new Error('Số tiền không hợp lệ');
  }

  const [whole, decimal = ''] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
}

export function formatMoney(value: string): string {
  const normalized = normalizeMoneyInput(value);
  const [whole, decimal = ''] = normalized.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const significantDecimal = decimal.replace(/0+$/, '');
  return significantDecimal ? `${grouped},${significantDecimal}` : grouped;
}
