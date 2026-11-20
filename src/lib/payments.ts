import type { Role, Status } from './mutabee';

export type PaymentKind = 'full' | 'partial' | 'scheduled' | 'discount';
export const canReviewPayment = (role: Role, projectIds: string[], projectId: string) => role === 'owner' || role === 'exec' || (role === 'supervisor' && projectIds.includes(projectId));
export const PAYMENT_STATUSES: Status[] = [
  { id: 's_partial', name: 'سداد جزئي', color: '#0891b2', closed: false, paid: false, parent: 's_paid' },
  { id: 's_scheduled', name: 'سداد جدولة', color: '#0d9488', closed: false, paid: false, parent: 's_paid' },
  { id: 's_discount', name: 'سداد بالخصم', color: '#ca8a04', closed: true, paid: false, parent: 's_paid' },
];
export function withPaymentStatuses(statuses: Status[]): Status[] {
  return [...statuses, ...PAYMENT_STATUSES.filter(s => !statuses.some(x => x.id === s.id))];
}
export function paymentKind(status?: Status): PaymentKind | null {
  if (status?.id === 's_partial') return 'partial';
  if (status?.id === 's_scheduled') return 'scheduled';
  if (status?.id === 's_discount') return 'discount';
  return status?.paid ? 'full' : null;
}
export function nextMonthDate(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || !year || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const end = new Date(Date.UTC(year, month + 1, 0));
  const next = new Date(Date.UTC(year, month, Math.min(day, end.getUTCDate())));
  return next.toISOString().slice(0, 10);
}
export const discountedAmount = (remaining: number, percent: number) => Math.round(remaining * (1 - percent / 100) * 100) / 100;
export function approvedTotals(c: { amount: number; approved_paid?: number; settlement_amount?: number | null }, st: Status) {
  const amt = Math.max(0, Number(c.amount) || 0);
  const paid = Math.max(0, Number(c.approved_paid) || 0);
  const target = c.settlement_amount ?? amt;
  const rem = Math.max(target - paid, 0);
  return { amt, paid, rem, closed: paymentKind(st) ? rem === 0 : !!st.closed };
}