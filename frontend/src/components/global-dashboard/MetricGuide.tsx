/** Keep the financial and attendance definitions available without crowding the comparison. */
export function MetricGuide() {
  return (
    <details className="surface p-4 text-sm text-gray-500 dark:text-gray-400">
      <summary className="cursor-pointer font-medium">How these figures are calculated</summary>
      <div className="space-y-2 pt-3">
        <p>Revenue is active-bill gross sales less discounts, before service charge, tax, and tips. Discounts include line and checkout discounts.</p>
        <p>Commissions use the property payroll calculation, including tips. They may change while attendance is incomplete. Certifications are tracked separately.</p>
        <p>Currency totals are grouped without conversion. Inactive properties remain included; removed properties are excluded.</p>
        <p>Missing attendance counts one entry per employed, active dive staff member per past day. Today and future dates are excluded. Partial days count.</p>
        <p>Select a financial figure to open its property and report period. Missing attendance opens the first incomplete date.</p>
      </div>
    </details>
  );
}
