import { formatMoney } from '../../utils/format';
import type { BillModel } from './useBillController';

export function BillTotals({ model }: { model: BillModel }) {
  const { checkoutDiscountPercent, checkoutPreview, currencySymbol, grossAmount, lineDiscountAmount, netTotal, scRate, serviceChargeAmount, taxAmount, taxRate, tipAmount } = model;
  return (
    <section aria-label="Final bill total" className="bill-total-panel bill-total-summary">
      <div className="bill-total-breakdown">
        <h3 className="bill-total-heading">Bill summary</h3>
        <dl>
          <div><dt>Gross total</dt><dd>{formatMoney(grossAmount, currencySymbol)}</dd></div>
          {lineDiscountAmount > 0 && <div className="bill-total-discount"><dt>Line discounts</dt><dd>−{formatMoney(lineDiscountAmount, currencySymbol)}</dd></div>}
          {checkoutPreview.amount > 0 && <div className="bill-total-discount"><dt>Checkout discount ({checkoutDiscountPercent}%)</dt><dd>−{formatMoney(checkoutPreview.amount, currencySymbol)}</dd></div>}
          <div><dt>Service charge ({scRate}%)</dt><dd>{formatMoney(serviceChargeAmount, currencySymbol)}</dd></div>
          <div><dt>Tax / TGST ({taxRate}%)</dt><dd>{formatMoney(taxAmount, currencySymbol)}</dd></div>
          {tipAmount > 0 && <div><dt>Guest tip</dt><dd>{formatMoney(tipAmount, currencySymbol)}</dd></div>}
        </dl>
      </div>
      <div className="bill-total-due">
        <span>Net check total</span>
        <strong aria-live="polite" aria-atomic="true">{formatMoney(netTotal, currencySymbol)}</strong>
      </div>
    </section>
  );
}
