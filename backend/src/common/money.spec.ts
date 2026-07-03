import {
  MAX_MONEY_MINOR_UNITS,
  minorUnitsToMoney,
  moneyToMinorUnits,
  normalizeMoney,
} from './money';

describe('money helpers', () => {
  it('chuyển decimal sang đơn vị nhỏ nhất mà không dùng number', () => {
    expect(moneyToMinorUnits('1234567890123456.78')).toBe(123456789012345678n);
  });

  it('chuẩn hóa phần thập phân', () => {
    expect(normalizeMoney('10')).toBe('10.00');
    expect(normalizeMoney('10.5')).toBe('10.50');
  });

  it('hỗ trợ đúng biên numeric(18,2)', () => {
    expect(minorUnitsToMoney(MAX_MONEY_MINOR_UNITS)).toBe(
      '9999999999999999.99',
    );
  });

  it.each(['-1', '01', '1.234', '10000000000000000.00', 'abc'])(
    'từ chối giá trị không hợp lệ: %s',
    (value) => {
      expect(() => moneyToMinorUnits(value)).toThrow();
    },
  );
});
