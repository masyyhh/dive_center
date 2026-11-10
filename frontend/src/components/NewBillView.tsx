import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useBillController } from './billing/useBillController';
import type { NewBillViewProps } from './billing/useBillController';
import { BillToolbar } from './billing/BillToolbar';
import { ActivityCatalogue } from './billing/ActivityCatalogue';
import { BillDraftPanel } from './billing/BillDraftPanel';
import { BillCheckout } from './billing/BillCheckout';
import { BillDialogs } from './billing/BillDialogs';

export function NewBillView(props: NewBillViewProps) {
  const model = useBillController(props);
  const [catalogueMount, setCatalogueMount] = useState<HTMLElement | null>(null);
  const { compactBilling, editReason, editingBill, errorMsg, monthLock, saving, setDiscardOpen, setEditReason, setStaffReload, staffLoading, staffNotice, staffReady } = model;
  useEffect(() => { setCatalogueMount(compactBilling ? document.getElementById('bill-catalogue-sidebar') : null); }, [compactBilling]);
  useEffect(() => {
    if (compactBilling && model.attemptedReview && model.checkoutPreview.error) document.getElementById('checkout-discount')?.focus();
  }, [compactBilling, errorMsg, model.attemptedReview, model.checkoutPreview.error]);
  return (
    <div className={compactBilling ? "bill-builder siyam-bill siyam-ledger" : "bill-builder space-y-6"} data-editing={editingBill ? true : undefined} aria-busy={saving}>
      {editingBill && <section className="surface p-4 space-y-3"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Edit posted bill #{editingBill.checkNumber}</h2><button type="button" className="secondary-button" disabled={saving} onClick={() => setDiscardOpen(true)}>Cancel editing</button></div><p>Changes and the original bill are recorded in the audit log. Existing discounts are already included in each saved line. Personal commissions will be recalculated after discounts. Locked payroll months cannot be edited.</p><label htmlFor="bill-edit-reason">Reason for correction <span aria-hidden="true">*</span><input id="bill-edit-reason" required minLength={5} maxLength={1000} disabled={saving} value={editReason} onChange={event => setEditReason(event.target.value)} className="w-full" /></label></section>}
      <BillToolbar model={model} />
      {model.saveNotice && <div className="notice notice-success" role="status"><CheckCircle2 size={18} /><span>{model.saveNotice}</span><button type="button" className="text-button" onClick={() => model.setSaveNotice('')}>Dismiss</button></div>}
      {staffNotice && !staffReady && <div className="notice notice-info" role="status"><span>{staffNotice}</span>{!staffLoading && <button type="button" onClick={() => setStaffReload(value => value + 1)}>Retry staff availability</button>}</div>}
      {errorMsg && <div role="alert" className="notice notice-error"><AlertCircle size={18} /><span>{errorMsg}</span></div>}
      {monthLock.locked && <div className="notice notice-info"><span>This business month is locked for payroll. Your draft can be edited, but choose a date in an open month before saving.</span></div>}
      {monthLock.error && <div role="alert" className="notice notice-error"><span>Could not check payroll status. Your draft is safe; retry before saving.</span><button onClick={monthLock.retry}>Retry</button></div>}
      {compactBilling ? <>
        {catalogueMount && createPortal(<ActivityCatalogue model={model} />, catalogueMount)}
        <div className={`bill-work-area${!catalogueMount ? ' has-catalogue-fallback' : ''}`}>{!catalogueMount && <ActivityCatalogue model={model} />}<BillDraftPanel model={model} /></div>
      </> : <div className="bill-work-area grid grid-cols-1 xl:grid-cols-12 gap-6"><ActivityCatalogue model={model} /><BillDraftPanel model={model} /></div>}

      <BillCheckout model={model} />
      <BillDialogs model={model} />
    </div>
  );
}
