import { filterAmountInput, formatExpenseAmount, parseExpenseAmount, splitExpense } from './expense-calculations';

describe('Expense calculations', () => {
  describe('filterAmountInput', () => {
    it.each(['', '0', '123', '0,', '0.', '12,3', '12.34', '0,01'])('accepts editable numeric value %j', (value) => {
      expect(filterAmountInput(value, '5,00')).toBe(value);
    });

    it.each(['abc', '12a', '-1', '+1', '1e3', '1,234', '1..2', '1,,2', '1,2.3', '€10', '1 000', ' 12 ', '.5', ',5', 'NaN'])
      ('rejects %j without converting it into a different amount', (value) => {
        expect(filterAmountInput(value, '5,00')).toBe('5,00');
      });
  });
  describe('parseExpenseAmount', () => {
    it.each([
      ['10', 1000], ['10,25', 1025], ['10.25', 1025], [' 0,01 ', 1],
      ['1.5', 150], ['001,05', 105], ['90071992547409.90', 9007199254740990],
    ])('parses %s into integer cents', (value, expected) => {
      expect(parseExpenseAmount(value)).toBe(expected);
    });

    it.each(['', ' ', '0', '0,00', '-1', '+1', '1,234', '1.234', '1e3', '1 000',
      '1,000.00', '€10', 'NaN', 'Infinity', '.50', '1.', '90071992547410'])('rejects %j', (value) => {
      expect(parseExpenseAmount(value)).toBeNull();
    });
  });

  describe('splitExpense', () => {
    it('splits evenly without changing the caller selection', () => {
      const ids = ['mate-3', 'mate-1', 'mate-2'];
      expect(splitExpense(300, ids)).toEqual([
        { mateId: 'mate-1', amountCents: 100 }, { mateId: 'mate-2', amountCents: 100 },
        { mateId: 'mate-3', amountCents: 100 },
      ]);
      expect(ids).toEqual(['mate-3', 'mate-1', 'mate-2']);
    });

    it('assigns leftover cents deterministically by numeric member ID', () => {
      expect(splitExpense(101, ['mate-10', 'mate-2', 'mate-1'])).toEqual([
        { mateId: 'mate-1', amountCents: 34 }, { mateId: 'mate-2', amountCents: 34 },
        { mateId: 'mate-10', amountCents: 33 },
      ]);
    });

    it('supports a single participant and shares smaller than one cent', () => {
      expect(splitExpense(1, ['a'])).toEqual([{ mateId: 'a', amountCents: 1 }]);
      expect(splitExpense(1, ['c', 'b', 'a'])).toEqual([
        { mateId: 'a', amountCents: 1 }, { mateId: 'b', amountCents: 0 }, { mateId: 'c', amountCents: 0 },
      ]);
    });

    it.each([1, 2, 99, 100, 101, 5000, Number.MAX_SAFE_INTEGER])('conserves %s cents', (amount) => {
      const shares = splitExpense(amount, ['c', 'a', 'b']);
      expect(shares.reduce((sum, share) => sum + share.amountCents, 0)).toBe(amount);
      expect(Math.max(...shares.map((share) => share.amountCents))
        - Math.min(...shares.map((share) => share.amountCents))).toBeLessThanOrEqual(1);
    });

    it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid cents %s', (amount) => {
      expect(() => splitExpense(amount, ['a'])).toThrow();
    });

    it.each([[], ['a', 'a'], [''], ['a', ' ']].map((ids) => ({ ids })))('rejects invalid participants $ids', ({ ids }) => {
      expect(() => splitExpense(100, ids)).toThrow();
    });
  });

  it.each([0, 1, 105, 5000])('formats %s cents as Spanish euros', (cents) => {
    const text = formatExpenseAmount(cents).replace(/\s/g, '');
    expect(text).toBe((cents / 100).toFixed(2).replace('.', ',') + '€');
  });
});
