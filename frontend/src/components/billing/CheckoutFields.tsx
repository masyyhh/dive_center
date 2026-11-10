import type { BillModel } from './useBillController';

export function TipControl({ model }: { model: BillModel }) {
  const {
    currencySymbol, saving, setTipAmount, tipAmount,
  } = model;
  return (
    <div>
      <label htmlFor="newbillview-field-10" className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
        Guest Tip ({currencySymbol})
      </label>
      <input id="newbillview-field-10"
        type="number"
        min="0"
        step="0.01"
        value={tipAmount || ''} disabled={saving}
        onChange={(e) => setTipAmount(Math.max(0, parseFloat(e.target.value) || 0))}
        placeholder="0.00"
        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </div>
  );
}

export function DiscountControl({ model }: { model: BillModel }) {
  const {
    compactBilling, checkoutDiscountValue, checkoutPreview, errorMsg, saving,
    setCheckoutDiscountValue, setErrorMsg,
  } = model;
  return (
    <div className="checkout-discount-control rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <label htmlFor="checkout-discount" className="block font-semibold">{compactBilling ? 'Enter discount (%)' : 'Discount (%)'}</label>
      <div className="flex gap-2">
        <input id="checkout-discount" type="number" min="0" max="100" step="0.01" placeholder="0" value={checkoutDiscountValue} disabled={saving} onChange={event => { setCheckoutDiscountValue(event.target.value); if (errorMsg?.startsWith('Checkout discount')) setErrorMsg(null); }} aria-invalid={!!checkoutPreview.error} aria-describedby="checkout-discount-help checkout-discount-error" className="min-w-0 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 font-mono" />
      </div>
      <p id="checkout-discount-help" className={compactBilling ? "text-xs text-slate-500" : "sr-only"}>Applies to all remaining item and Photo totals after line discounts, before service charge and tax. Tips are excluded.</p>
      <p id="checkout-discount-error" role={checkoutPreview.error ? 'alert' : undefined} className="text-sm text-red-600">{checkoutPreview.error}</p>
    </div>
  );
}
