import React from 'react';
import { PersonalCommissionSummary } from './PersonalCommissionEditor';
import { formatMoney } from '../utils/format';
import type { Item } from '../types';
export interface CatalogueImportPreview {
  created: number;
  updated: number;
  total: number;
  previewRows: {
    action: 'create' | 'update';
    code: string; name: string; category: string; price: number; isActive: boolean;
    commission: { poolType: Item['poolType']; poolContribution: number; personalRates: Record<string, number>; includesComplimentaryMedia?: boolean };
  }[];
}
const poolLabels = { NONE: 'No pool', COURSE_POOL: 'Course pool', DIVE_POOL: 'Dive pool', CERTIFICATION_POOL: 'Certifications' };
export const CatalogueImportReview: React.FC<{
  data: CatalogueImportPreview;
  fileName: string;
  propertyName: string;
  currencySymbol: string;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}> = ({ data, fileName, propertyName, currencySymbol, busy, onApply, onCancel }) => (
  <section className="surface catalogue-import-review" aria-label="Review catalogue import">
    <div><h4>Review your import</h4><p><strong>{fileName}</strong> → {propertyName}</p></div>
    <div className="import-review-counts"><span><strong>{data.created}</strong> new {data.created === 1 ? 'activity' : 'activities'}</span><span><strong>{data.updated}</strong> {data.updated === 1 ? 'update' : 'updates'}</span><span><strong>{data.total}</strong> validated rows</span></div>
    <p>Your file has been checked. Nothing has been imported yet. Existing item codes update matching services; blank codes are generated when you save.</p>
    <div className="import-review-table"><table><thead><tr><th>Change</th><th>Item code</th><th>Service</th><th>Category</th><th>Price</th><th>Pool</th><th>Employee payments</th><th>Status</th></tr></thead><tbody>
      {data.previewRows.map((row, index) => <tr key={index}>
        <td><span className={`status-badge ${row.action === 'create' ? 'status-active' : 'status-rebated'}`}>{row.action === 'create' ? 'New' : 'Update'}</span></td>
        <td>{row.code || 'Auto-generated'}</td><td><strong>{row.name}</strong></td><td>{row.category}</td><td>{formatMoney(row.price, currencySymbol)}</td>
        <td>{poolLabels[row.commission.poolType]}{row.commission.poolType !== 'NONE' && <small>{row.commission.poolType === 'COURSE_POOL' || row.commission.poolType === 'DIVE_POOL' ? `${row.commission.poolContribution}% after discounts` : `${formatMoney(row.commission.poolContribution, currencySymbol)} / unit`}</small>}</td>
        <td><PersonalCommissionSummary item={{ personalRatesJson: JSON.stringify(row.commission.personalRates), includesComplimentaryMedia: row.commission.includesComplimentaryMedia ?? false }} currencySymbol={currencySymbol} /></td><td>{row.isActive ? 'Active' : 'Inactive'}</td>
      </tr>)}
    </tbody></table></div>
    {data.total > data.previewRows.length && <p>Showing {data.previewRows.length} of {data.total} checked rows. All rows will be imported.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className="primary-button" disabled={busy} onClick={onApply}>{busy ? 'Importing…' : `Import ${data.total} activities`}</button><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel import</button></div>
  </section>
);
