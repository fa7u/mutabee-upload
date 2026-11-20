import { describe, expect, it } from 'vitest';
import { approvedTotals, canReviewPayment, discountedAmount, nextMonthDate, PAYMENT_STATUSES } from '@/lib/payments';
import { DEFAULT_STATUSES } from '@/lib/mutabee';

describe('payment rules', () => {
  it('offers approval to the project supervisor and to owner/exec', () => {
    expect(canReviewPayment('supervisor', ['project-a'], 'project-a')).toBe(true);
    expect(canReviewPayment('supervisor', ['project-b'], 'project-a')).toBe(false);
    expect(canReviewPayment('employee', ['project-a'], 'project-a')).toBe(false);
    expect(canReviewPayment('owner', ['project-a'], 'project-a')).toBe(true);
    expect(canReviewPayment('exec', ['project-a'], 'project-a')).toBe(true);
  });
  it('never counts full payment by status alone before supervisor approval', () => {
    const full = DEFAULT_STATUSES.find(s => s.paid);
    if (!full) throw new Error('Missing full status');
    expect(approvedTotals({ amount: 1000, approved_paid: 0 }, full)).toEqual({ amt: 1000, paid: 0, rem: 1000, closed: false });
  });
  it('counts only approved partial payments', () => {
    const partial = PAYMENT_STATUSES.find(s => s.id === 's_partial');
    if (!partial) throw new Error('Missing partial status');
    expect(approvedTotals({ amount: 1000, approved_paid: 250 }, partial)).toEqual({ amt: 1000, paid: 250, rem: 750, closed: false });
  });
  it('schedules the same day in the following month', () => {
    expect(nextMonthDate('2026-11-01')).toBe('2026-12-01');
    expect(nextMonthDate('2026-12-15')).toBe('2027-01-15');
  });
  it('uses month end when the next month has no equivalent day', () => {
    expect(nextMonthDate('2027-01-31')).toBe('2027-02-28');
    expect(nextMonthDate('2028-01-31')).toBe('2028-02-29');
  });
  it('calculates the amount after discount', () => {
    expect(discountedAmount(1000, 20)).toBe(800);
  });
  it('closes a discounted payment only after its adjusted amount is approved', () => {
    const discount = PAYMENT_STATUSES.find(s => s.id === 's_discount');
    if (!discount) throw new Error('Missing discount status');
    expect(approvedTotals({ amount: 1000, approved_paid: 800, settlement_amount: 800 }, discount)).toEqual({ amt: 1000, paid: 800, rem: 0, closed: true });
    expect(approvedTotals({ amount: 1000, approved_paid: 0 }, discount).closed).toBe(false);
  });
  it('keeps the three payment sub-statuses under the main paid status', () => {
    expect(PAYMENT_STATUSES.every(s => s.parent === 's_paid')).toBe(true);
    expect(DEFAULT_STATUSES.find(s => s.id === 's_paid')?.parent).toBe(undefined);
  });
});
