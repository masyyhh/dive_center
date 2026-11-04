import { formatMoney } from '../../utils/format';
import type { GlobalDashboardModel } from './useGlobalDashboardController';

export function CurrencyTotals({ model }: { model: GlobalDashboardModel }) {
  const {
    data,
  } = model;
  if (!data) return null;
  return (
    <section className="global-currency-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Totals by currency">
      {data.totals.currencies.map(total => (
        <div className="overview-currency-card surface p-5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4" key={total.currency}>
          <h2 className="font-bold text-lg text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800 pb-2">
            {total.currency} totals
          </h2>
          <dl className="global-totals grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400 font-medium">Revenue</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{formatMoney(total.revenue, `${total.currency} `)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400 font-medium">Discounts</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{formatMoney(total.discounts, `${total.currency} `)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400 font-medium">Commissions</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{formatMoney(total.commissions, `${total.currency} `)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400 font-medium">Active bills</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{total.billCount}</dd>
            </div>
          </dl>
        </div>
      ))}
    </section>
  );
}
