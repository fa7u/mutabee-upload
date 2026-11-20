import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/external/client';
import type { Tables } from '@/integrations/supabase/types';
import { money, todayRiyadh } from '@/lib/mutabee';
import { discountedAmount, nextMonthDate, type PaymentKind } from '@/lib/payments';
import { errMsg } from './data';

export type PaymentInput = { kind: PaymentKind; amount: number; discount: number | null; date: string };
export function PaymentFields({ kind, remaining, onChange }: { kind: PaymentKind; remaining: number; onChange: (p: PaymentInput) => void }) {
  const [amount, setAmount] = useState(kind === 'full' ? String(remaining) : '');
  const [discount, setDiscount] = useState('');
  const [date, setDate] = useState(todayRiyadh());
  useEffect(() => { onChange({ kind, amount: Number(amount), discount: kind === 'discount' ? (discount === '' ? null : Number(discount)) : null, date }); }, [kind, amount, discount, date, onChange]);
  return <>
    {kind === 'discount' && <label>نسبة الخصم (%)<input type="number" min="0" max="100" step="0.01" value={discount} onChange={e => { setDiscount(e.target.value); setAmount(String(discountedAmount(remaining, Number(e.target.value)))); }} /></label>}
    <label>{kind === 'discount' ? 'المبلغ بعد الخصم' : 'المبلغ المدفوع'}<input type="number" min="0.01" max={remaining} step="0.01" value={amount} readOnly={kind === 'full'} onChange={e => setAmount(e.target.value)} /></label>
    <label>تاريخ السداد<input type="date" max={todayRiyadh()} value={date} onChange={e => setDate(e.target.value)} /></label>
    {kind === 'scheduled' && date && <label>التذكير القادم<input type="date" readOnly value={nextMonthDate(date)} /></label>}
  </>;
}

export function PaymentReview({ projectId, claimId, meId, canReview, canDelete, onReviewed, claimLabel }: { projectId: string; claimId?: string; meId?: string; canReview: boolean; canDelete?: boolean; onReviewed: () => void; claimLabel?: (claimId: string) => string }) {
  const [rows, setRows] = useState<Tables<'claim_payments'>[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = async () => {
    let query = supabase.from('claim_payments').select('*').eq('project_id', projectId).order('submitted_at', { ascending: false });
    if (claimId) query = query.eq('claim_id', claimId);
    else query = query.eq('state', 'pending');
    const { data, error } = await query;
    if (error) setError(errMsg(error)); else setRows(data || []);
  };
  useEffect(() => { void load(); const listener = () => void load(); window.addEventListener('focus', listener); return () => window.removeEventListener('focus', listener); }, [projectId, claimId]); // eslint-disable-line react-hooks/exhaustive-deps
  const review = async (id: string, approve: boolean) => {
    setBusy(true); setError('');
    const { error } = await supabase.rpc('review_claim_payment', { p_id: id, p_approve: approve, p_note: notes[id] || '' });
    if (error) setError(errMsg(error)); else { await load(); onReviewed(); }
    setBusy(false);
  };
  const del = async (id: string) => {
    if (!window.confirm('حذف هذا السداد نهائيًا؟ إن كان معتمدًا سيُعكس أثره على المطالبة.')) return;
    setBusy(true); setError('');
    const { error } = await supabase.rpc('delete_claim_payment', { p_id: id });
    if (error) setError(errMsg(error)); else { await load(); onReviewed(); }
    setBusy(false);
  };
  const labels = { full: 'سداد كامل', partial: 'سداد جزئي', scheduled: 'سداد جدولة', discount: 'سداد بالخصم' };
  return <section>
    <div className="row"><h3 className="grow">{claimId ? 'السدادات' : 'اعتماد السدادات'}</h3><Button variant="outline" onClick={() => void load()}>تحديث</Button></div>
    {error && <p className="err" role="alert">{error}</p>}
    <div className="tw"><table className="cards"><thead><tr>{!claimId && <th>المطالبة</th>}<th>نوع السداد</th><th>المبلغ</th><th>تاريخ السداد</th><th>الخصم</th><th>الموافقة</th>{canDelete && <th></th>}</tr></thead><tbody>
      {rows.map(row => <tr key={row.id}>
        {!claimId && <td data-label="المطالبة">{claimLabel ? claimLabel(row.claim_id) : row.claim_id}</td>}
        <td data-label="نوع السداد">{labels[row.kind as PaymentKind] || row.kind}</td><td data-label="المبلغ">{money(row.amount)}</td><td data-label="تاريخ السداد">{row.paid_on}</td><td data-label="الخصم">{row.discount_percent == null ? '—' : `${row.discount_percent}%`}</td>
        <td data-label="الموافقة">{row.state === 'pending' ? <div className="form"><span>بانتظار موافقة المشرف</span>{canReview && meId && row.submitted_by === meId && <p className="muted small">لا يمكنك اعتماد سداد قدّمتَه بنفسك</p>}{canReview && !(meId && row.submitted_by === meId) && <><input aria-label="ملاحظة المراجعة" placeholder="ملاحظة المراجعة" value={notes[row.id] || ''} onChange={e => setNotes({ ...notes, [row.id]: e.target.value })} /><div className="row"><Button disabled={busy} onClick={() => void review(row.id, true)}>اعتماد</Button><Button variant="outline" disabled={busy} onClick={() => void review(row.id, false)}>رفض</Button></div></>}</div> : <>{row.state === 'approved' ? 'معتمد' : 'مرفوض'}{row.review_note && <p>{row.review_note}</p>}</>}</td>
        {canDelete && <td data-label=""><Button variant="outline" disabled={busy} onClick={() => void del(row.id)}>حذف</Button></td>}
      </tr>)}
      {!rows.length && <tr><td colSpan={canDelete ? 7 : 6} className="center muted">لا توجد سدادات {claimId ? '' : 'بانتظار الموافقة'}</td></tr>}
    </tbody></table></div>
  </section>;
}