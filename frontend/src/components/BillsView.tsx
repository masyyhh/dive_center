import { NewBillView } from './NewBillView';

import { CheckCircle2 } from 'lucide-react';
import { useBillsController } from './bills/useBillsController';
import type { BillsViewProps } from './bills/useBillsController';
import { BillsFilters } from './bills/BillsFilters';
import { BillsTable } from './bills/BillsTable';
import { BillDetails } from './bills/BillDetails';
import { BillActionDialogs } from './bills/BillActionDialogs';

export function BillsView(props: BillsViewProps) {
  const model = useBillsController(props);
  const {
    closeBillDetails, editSuccess, editingBill, fetchBills,
    onDismissSaved, onSetup, savedCheck, setEditSuccess,
    setEditingBill,
  } = model;
  if (editingBill) return <NewBillView key={`${editingBill.id}:${editingBill.updatedAt}`} editingBill={editingBill} onCancel={() => setEditingBill(null)} onSetup={onSetup} onBillSaved={check => { setEditingBill(null); closeBillDetails(); setEditSuccess(`Bill #${check} updated. The correction was recorded in the audit log.`); void fetchBills(); }} />;
  return (
    <div className="space-y-6">
      {editSuccess && <div className="notice notice-success" role="status"><span>{editSuccess}</span><button onClick={() => setEditSuccess('')}>Dismiss</button></div>}
      {savedCheck !== null && <div className="notice notice-success" role="status"><CheckCircle2 size={18} /><span>Bill #{savedCheck} saved successfully. Find it by its business date below.</span><button onClick={onDismissSaved}>Dismiss</button></div>}
      <BillsFilters model={model} />
      <BillsTable model={model} />
      <BillDetails model={model} />
      <BillActionDialogs model={model} />
    </div>
  );
}
