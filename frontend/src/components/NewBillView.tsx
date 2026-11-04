import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useBillController } from './billing/useBillController';
import type { NewBillViewProps } from './billing/useBillController';
import { BillToolbar } from './billing/BillToolbar';
import { ActivityCatalogue } from './billing/ActivityCatalogue';
import { BillDraftPanel } from './billing/BillDraftPanel';
import { BillCheckout } from './billing/BillCheckout';
import { BillDialogs } from './billing/BillDialogs';

export function NewBillView(props: NewBillViewProps) {
  const model = useBillController(props);
  const [panel, setPanel] = useState('bill');
  const { compactBilling, editReason, editingBill, errorMsg, monthLock, saving, setDiscardOpen, setEditReason, setStaffReload, staffLoading, staffNotice, staffReady } = model;
  useEffect(() => {
    if (compactBilling && panel === 'activities') document.querySelector<HTMLInputElement>('.siyam-activity-picker input[aria-label="Search catalogue"]')?.focus();
  }, [compactBilling, panel]);
  useEffect(() => {
    if (compactBilling && panel === 'bill' && model.attemptedReview && model.checkoutPreview.error) {
      document.getElementById('checkout-discount')?.focus();
    }
  }, [compactBilling, panel, errorMsg, model.attemptedReview, model.checkoutPreview.error]);
  return (
    <div className={compactBilling ? "bill-builder siyam-bill siyam-ledger" : "space-y-6"} data-panel={panel} data-editing={editingBill ? true : undefined} aria-busy={saving}>
      {editingBill && <section className="surface p-4 space-y-3"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Edit posted bill #{editingBill.checkNumber}</h2><button type="button" className="secondary-button" disabled={saving} onClick={() => setDiscardOpen(true)}>Cancel editing</button></div><p>Changes and the original bill are recorded in the audit log. Existing discounts are already included in each saved line. Personal commissions will be recalculated after discounts. Locked payroll months cannot be edited.</p><label htmlFor="bill-edit-reason">Reason for correction <span aria-hidden="true">*</span><input id="bill-edit-reason" required minLength={5} maxLength={1000} disabled={saving} value={editReason} onChange={event => setEditReason(event.target.value)} className="w-full" /></label></section>}
      <BillToolbar model={model} />
      {staffNotice && !staffReady && <div className="notice notice-info" role="status"><span>{staffNotice}</span>{!staffLoading && <button type="button" onClick={() => setStaffReload(value => value + 1)}>Retry staff availability</button>}</div>}
      {errorMsg && <div role="alert" className="notice notice-error"><AlertCircle size={18} /><span>{errorMsg}</span></div>}
      {monthLock.locked && <div className="notice notice-info"><span>This business month is locked for payroll. Your draft can be edited, but choose a date in an open month before saving.</span></div>}
      {monthLock.error && <div role="alert" className="notice notice-error"><span>Could not check payroll status. Your draft is safe; retry before saving.</span><button onClick={monthLock.retry}>Retry</button></div>}
      {compactBilling ? <>
        <div className="siyam-entry-toolbar">
          <details className="siyam-activity-picker" onKeyDown={event => { if (event.key === 'Escape') { setPanel('bill'); event.currentTarget.querySelector('summary')?.focus(); } }} open={panel === 'activities'} onToggle={event => setPanel(event.currentTarget.open ? 'activities' : 'bill')}>
            <summary>Add activity</summary>
            <div className="siyam-activity-popover"><ActivityCatalogue model={model} /><button type="button" className="primary-button" onClick={event => { setPanel('bill'); event.currentTarget.closest('details')?.querySelector('summary')?.focus(); }}>Done · {model.billLines.length} bill lines</button></div>
          </details>
          <span>{model.billLines.length} bill lines</span>
        </div>
        <div className="bill-work-area"><BillDraftPanel model={model} /></div>
      </> : <div className="bill-work-area grid grid-cols-1 xl:grid-cols-12 gap-6"><ActivityCatalogue model={model} /><BillDraftPanel model={model} /></div>}

      <BillCheckout model={{ ...model, reviewBill: () => { setPanel(model.billLines.length ? 'bill' : 'activities'); model.reviewBill(); } }} />
      <BillDialogs model={model} />
    </div>
  );
}
