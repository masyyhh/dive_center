import { NewBillView } from './NewBillView';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { CheckCircle2 } from 'lucide-react';
import { useBillsController } from './bills/useBillsController';
import type { BillsViewProps } from './bills/useBillsController';
import { BillsFilters, BillResultsSummary } from './bills/BillsFilters';
import { BillsTable } from './bills/BillsTable';
import { BillDetails } from './bills/BillDetails';
import { BillActionDialogs } from './bills/BillActionDialogs';

export function BillsView(props: BillsViewProps) {
  const model = useBillsController(props);
  const [summaryTarget, setSummaryTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setSummaryTarget(model.splitView && typeof document !== 'undefined' ? document.getElementById('bills-header-summary') : null); }, [model.splitView]);
  const {
    closeBillDetails, editSuccess, editingBill, fetchBills,
    onDismissSaved, onSetup, savedCheck, setEditSuccess,
    setEditingBill,
  } = model;
  if (editingBill) return <NewBillView key={`${editingBill.id}:${editingBill.updatedAt}`} editingBill={editingBill} onCancel={() => setEditingBill(null)} onSetup={onSetup} onBillSaved={check => { setEditingBill(null); closeBillDetails(); setEditSuccess(`Bill #${check} updated. The correction was recorded in the audit log.`); void fetchBills(); }} />;
  return (
    <div className={model.splitView ? 'siyam-bills-view space-y-4' : 'space-y-6'}>
      {model.splitView && summaryTarget && createPortal(<BillResultsSummary model={model} />, summaryTarget)}
      {editSuccess && <div className="notice notice-success" role="status"><span>{editSuccess}</span><button onClick={() => setEditSuccess('')}>Dismiss</button></div>}
      {savedCheck !== null && <div className="notice notice-success" role="status"><CheckCircle2 size={18} /><span>Bill #{savedCheck} saved successfully. Find it by its business date below.</span><button onClick={onDismissSaved}>Dismiss</button></div>}
      {model.splitView ? <div className="siyam-bills-filters"><BillsFilters model={model} summaryInHeader={Boolean(summaryTarget)} /></div> : <BillsFilters model={model} />}
      {model.splitView ? <div className="siyam-bills-split"><BillsTable model={model} compact /><BillDetails model={model} inline /></div> : <><BillsTable model={model} /><BillDetails model={model} /></>}
      <BillActionDialogs model={model} />
    </div>
  );
}
