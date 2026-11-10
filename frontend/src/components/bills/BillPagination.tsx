import type { BillsModel } from './useBillsController';

export function BillPagination({ model }: { model: BillsModel }) {
  if (!model.nextCursor && model.pageIndex === 0) return null;
  return <nav className="pagination-controls" aria-label="Bills pagination">
    <span role="status">Page {model.pageIndex + 1} · {model.visibleBills.length} bills on this page</span>
    <div className="pagination-actions">
      <button type="button" disabled={model.loading || model.pageIndex === 0} onClick={model.previousPage}>Previous</button>
      <button type="button" disabled={model.loading || !model.nextCursor} onClick={model.nextPage}>Next</button>
    </div>
  </nav>;
}
