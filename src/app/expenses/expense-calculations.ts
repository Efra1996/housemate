import type { ExpenseShare } from '../interfaces/expense.interface';

export function parseExpenseAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [euros, fraction = ''] = normalized.split('.');
  const cents = Number(euros) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function splitExpense(amountCents: number, participantIds: readonly string[]): ExpenseShare[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !participantIds.length
    || participantIds.some((id) => !id.trim()) || new Set(participantIds).size !== participantIds.length) {
    throw new Error('Expected positive integer cents and unique participant IDs.');
  }
  const ids = [...participantIds].sort((first, second) => first.localeCompare(second, 'en', { numeric: true }));
  const base = Math.floor(amountCents / ids.length);
  const remainder = amountCents % ids.length;
  return ids.map((mateId, index) => ({ mateId, amountCents: base + (index < remainder ? 1 : 0) }));
}

export function formatExpenseAmount(cents: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
