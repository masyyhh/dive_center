import { formatMoney } from '../../utils/format';

import { ChevronRight } from 'lucide-react';
import { TipControl, DiscountControl } from './CheckoutFields';
import type { BillModel } from './useBillController';

export function BillCheckout({ model }: { model: BillModel }) {
  const {
    compactBilling, currencySymbol, netBeforeCharges, netTotal,
    reviewBill, saving, scRate, serviceChargeAmount,
    setupLoading, taxAmount, taxRate,
  } = model;
  return (
    <>
      {compactBilling && <section className="siyam-checkout" aria-label="Bill checkout">
        <div className="siyam-checkout-inputs">{<DiscountControl model={model} />}{<TipControl model={model} />}</div>
        <dl className="siyam-checkout-totals">
          <div><dt>Subtotal</dt><dd>{formatMoney(netBeforeCharges, currencySymbol)}</dd></div>
          <div><dt>Service charge ({scRate}%)</dt><dd>{formatMoney(serviceChargeAmount, currencySymbol)}</dd></div>
          <div><dt>T-GST ({taxRate}%)</dt><dd>{formatMoney(taxAmount, currencySymbol)}</dd></div>
          <div className="siyam-grand-total"><dt>Grand total</dt><dd aria-live="polite">{formatMoney(netTotal, currencySymbol)}</dd></div>
        </dl>
        <button type="button" className="primary-button" onClick={reviewBill} disabled={saving || setupLoading}>{saving ? 'Saving…' : 'Save'}<ChevronRight size={16} /></button>
      </section>}

    </>
  );
}
