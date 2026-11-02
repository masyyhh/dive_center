import React from 'react';
import { Modal } from './Modal';
import { formatMoney, formatUnitPrice } from '../utils/format';
export interface BulkMediaReviewData {
  propertyId: string;
  includesComplimentaryMedia: boolean;
  total: number;
  changedCount: number;
  items: { id: string; code: string; name: string; includesComplimentaryMedia: boolean; updatedAt: string }[];
}
export const BulkMediaReview: React.FC<{ autoPhotoPrice?: number; autoPhotoCommission?: number; currencySymbol?: string; review: BulkMediaReviewData; busy: boolean; error: string | null; onClose: () => void; onApply: () => void; onRefresh: () => void }> = ({ review, busy, error, onClose, onApply, onRefresh, autoPhotoPrice = 41.975, autoPhotoCommission = 4.5, currencySymbol = '$' }) => (
  <Modal label="Review automatic Photo changes" busy={busy} onClose={onClose} error={error}>
    <div className="surface bulk-review p-5 space-y-4">
      <h2 className="text-xl font-bold">Review automatic Photo changes</h2>
      <p>{review.includesComplimentaryMedia ? `Add a separate ${formatUnitPrice(autoPhotoPrice, currencySymbol)} Photo line on top of each service unit on new bills. One selected team member earns ${formatMoney(autoPhotoCommission, currencySymbol)} per Photo unit.` : 'Stop adding the Photo line on new bills. Each service’s separate employee payment settings resume.'}</p>
      <p className="text-sm text-slate-500">{review.changedCount} of {review.total} selected services will change. Saved bills and their payments are retained.</p>
      <div className="bulk-review-items"><table className="w-full text-sm"><thead><tr><th>Service</th><th>Current</th><th>After saving</th></tr></thead><tbody>
        {review.items.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.code}</small></td><td>{item.includesComplimentaryMedia ? `Photo +${formatUnitPrice(autoPhotoPrice, currencySymbol)}` : 'No automatic Photo'}</td><td>{item.includesComplimentaryMedia === review.includesComplimentaryMedia ? 'No change' : review.includesComplimentaryMedia ? `Photo +${formatUnitPrice(autoPhotoPrice, currencySymbol)} · employee ${formatMoney(autoPhotoCommission, currencySymbol)}` : 'Separate settings'}</td></tr>)}
      </tbody></table></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        {error && <button type="button" className="secondary-button" disabled={busy} onClick={onRefresh}>Refresh review</button>}
        <button type="button" className="primary-button" disabled={busy || !review.changedCount || Boolean(error)} onClick={onApply}>{busy ? 'Saving…' : `Apply to ${review.changedCount} service${review.changedCount === 1 ? '' : 's'}`}</button>
      </div>
    </div>
  </Modal>
);
