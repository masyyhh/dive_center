import { formatMoney } from '../../utils/format';
import { isPositiveInt } from '../../utils/inputValidation';
import { isBusinessDate } from '../../utils/dates';

import { Plus, Minus, ChevronRight } from 'lucide-react';
import { GuestDetails } from './GuestDetails';
import type { BillModel } from './useBillController';

export function BillToolbar({ model }: { model: BillModel }) {
  const {
    attemptedReview, billLines, businessDate, checkNumber,
    compactBilling, currencySymbol, dirty, draftError,
    netTotal, restored, reviewBill, saving, setupLoading,
    setBusinessDate, setCheckEdited, setCheckNumber, setDiscardOpen,
    staffNotice,
  } = model;
  return (
    <section className="billing-toolbar" aria-label="Bill setup and total">
      <div className="billing-toolbar-top">
        {compactBilling ? <span className="billing-setup-label">Check details</span> : <nav className="billing-shortcuts" aria-label="Bill workflow">
          <a href="#bill-activities" onClick={e => { e.preventDefault(); document.getElementById('bill-activities')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>1 Activities</a>
          <a href="#bill-guest-details" onClick={e => { e.preventDefault(); document.getElementById('bill-room')?.focus(); }}>2 Guest details</a>
        </nav>}
        <details className="billing-help"><summary>Billing guidance</summary><div id="bill-check-help">Check numbers must be whole numbers from 1 to 2147483647. Fields marked * are required. {staffNotice || 'Only staff eligible on the business date can receive commission or tips.'}</div></details>
      </div>
      <div className="billing-toolbar-fields">
        <div className="billing-check-control">
          <label htmlFor="bill-check-number">Micros check #</label>
          <div className="billing-check-stepper">
            <button type="button" aria-label="Decrement check number" disabled={saving || checkNumber <= 1} onClick={() => { setCheckEdited(true); setCheckNumber(prev => Math.max(1, prev - 1)); }}><Minus size={15} /></button>
            <input type="number" id="bill-check-number" aria-label="Check number" aria-invalid={attemptedReview && !isPositiveInt(checkNumber)} aria-describedby="bill-check-help" min={1} max={2147483647} step={1} value={checkNumber} disabled={saving} onChange={e => { setCheckEdited(true); setCheckNumber(e.target.value === '' ? 0 : Number(e.target.value)); }} />
            <button type="button" aria-label="Increment check number" disabled={saving || checkNumber >= 2147483647} onClick={() => { setCheckEdited(true); setCheckNumber(prev => prev + 1); }}><Plus size={15} /></button>
          </div>
        </div>
        <div className="billing-date-control"><label htmlFor="bill-business-date">Business date</label><input type="date" id="bill-business-date" aria-label="Business date" aria-invalid={attemptedReview && !isBusinessDate(businessDate)} aria-describedby={attemptedReview && !isBusinessDate(businessDate) ? 'business-date-error' : undefined} value={businessDate} disabled={saving} onChange={e => setBusinessDate(e.target.value)} /></div>
        {!compactBilling && <div className="billing-toolbar-total"><div><span>{billLines.reduce((count, line) => count + (line.autoPhotoFor ? 0 : line.quantity), 0)} activities · Net total</span><strong>{formatMoney(netTotal, currencySymbol)}</strong></div><button type="button" className="primary-button" onClick={reviewBill} disabled={saving || setupLoading}>{saving ? 'Saving…' : 'Review bill'}<ChevronRight size={16} /></button></div>}
        {compactBilling && <GuestDetails model={model} />}
      </div>
      {attemptedReview && !isBusinessDate(businessDate) && <p id="business-date-error" className="field-error" role="alert">Choose a valid business date.</p>}
      {(restored || dirty) && <div className="billing-draft-status" role="status"><span>{draftError ? 'Draft storage unavailable. Keep this screen open until you save.' : restored ? (compactBilling ? 'Draft restored.' : 'Draft restored. Review the details before saving.') : (compactBilling ? 'Draft saved.' : 'Draft saved in this browser tab.')}</span><button type="button" className="text-button" disabled={saving} onClick={() => setDiscardOpen(true)}>Discard draft</button></div>}
    </section>
  );
}
