import { formatMoney, formatUnitPrice } from '../../utils/format';
import type { BillModel } from './useBillController';

export function BillTotals({ model }: { model: BillModel }) {
  const { checkoutDiscountPercent, checkoutPreview, currencySymbol, grossAmount, lineDiscountAmount, netTotal, photoRates, scRate, serviceChargeAmount, taxAmount, taxRate, tipAmount } = model;
  return (
    <section aria-label="Final bill total" className="bill-total-panel bg-slate-50 dark:bg-slate-800/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-sm">
      <h3 className="bill-total-heading">Final total</h3>
      <div className="flex justify-between text-slate-500 dark:text-slate-400">
        <span>Gross Total</span>
        <span className="font-mono font-medium">{formatMoney(grossAmount, currencySymbol)}</span>
      </div>
      {lineDiscountAmount > 0 && <div className="flex justify-between text-amber-600 dark:text-amber-400"><span>Line discounts</span><span className="font-mono">−{formatMoney(lineDiscountAmount, currencySymbol)}</span></div>}
      {checkoutPreview.amount > 0 && <div className="flex justify-between text-amber-600 dark:text-amber-400"><span>Checkout discount ({checkoutDiscountPercent}%)</span><span className="font-mono">−{formatMoney(checkoutPreview.amount, currencySymbol)}</span></div>}
      <div className="flex justify-between text-slate-500 dark:text-slate-400">
        <span>+ Service Charge ({scRate}%)</span>
        <span className="font-mono font-medium">{formatMoney(serviceChargeAmount, currencySymbol)}</span>
      </div>
      <div className="flex justify-between text-slate-500 dark:text-slate-400">
        <span>+ Tax / TGST ({taxRate}%)</span>
        <span className="font-mono font-medium">{formatMoney(taxAmount, currencySymbol)}</span>
      </div>
      {tipAmount > 0 && (
        <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
          <span>+ Guest Tip</span>
          <span className="font-mono font-medium">+{formatMoney(tipAmount, currencySymbol)}</span>
        </div>
      )}

      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-sm">
        <span className="font-semibold text-slate-900 dark:text-white">
          Net Check Total
        </span>
        <span className="text-xl font-bold text-sky-600 dark:text-sky-400 font-mono">
          {formatMoney(netTotal, currencySymbol)}
        </span>
      </div>

      <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-400 dark:text-slate-500 leading-normal">
        ℹ️ All activities, packages, and automatic Photo lines ({formatUnitPrice(photoRates.price ?? 41.975, currencySymbol)}/unit) are pre-tax and pre-service charge. Service charge ({scRate}%) and tax ({taxRate}%) are calculated at checkout.
      </div>
    </section>
  );
}
