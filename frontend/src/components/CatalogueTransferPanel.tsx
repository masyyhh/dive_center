import React, { useId } from 'react';
import { Download, Upload, FileSpreadsheet } from 'lucide-react';

export const CatalogueTransferPanel: React.FC<{
  propertyName?: string;
  busy: boolean;
  available: boolean;
  onExport: (format: 'csv' | 'xlsx', template?: boolean) => void;
  onImport: (file?: File) => void;
}> = ({ propertyName, busy, available, onExport, onImport }) => {
  const id = useId();
  const disabled = busy || !available;
  return <section className="catalogue-transfer" aria-label="Catalogue import and export">
    <div className="catalogue-transfer-card">
      <div className="catalogue-transfer-heading"><Download size={20} aria-hidden="true" /><div><h4>Export catalogue</h4><p>Download all activities for {propertyName || 'the selected property'}, including deleted activities.</p></div></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={disabled} onClick={() => onExport('xlsx')}><FileSpreadsheet size={16} />Download Excel</button><button type="button" className="secondary-button" disabled={disabled} onClick={() => onExport('csv')}>Download CSV</button></div>
      <p className="catalogue-transfer-caption">Keep a copy, edit services in bulk, then import the updated file.</p>
    </div>
    <div className="catalogue-transfer-card">
      <div className="catalogue-transfer-heading"><Upload size={20} aria-hidden="true" /><div><h4>Import catalogue</h4><p>Upload your changes, review them, then apply them together.</p></div></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={disabled} onClick={() => onExport('xlsx', true)}>Get Excel template</button><button type="button" className="text-button" disabled={disabled} onClick={() => onExport('csv', true)}>CSV template</button></div>
      <p className="catalogue-transfer-caption">Labelled columns for pool rates, employee payments and photo/video. Replace the example row with your own services.</p>
      <label htmlFor={`${id}-file`} className="catalogue-file-label">Choose your updated file</label>
      <input id={`${id}-file`} className="catalogue-file-input" type="file" accept=".csv,.xlsx" disabled={disabled} aria-describedby={`${id}-limits`} onChange={event => { onImport(event.target.files?.[0]); event.target.value = ''; }} />
      <small id={`${id}-limits`}>CSV or Excel (.xlsx) · Up to 3 MB · 2,000 activities</small>
    </div>
    <details className="catalogue-import-help"><summary>How bulk imports work</summary><ol><li>Download a template or export your current catalogue. Keep the column names and order.</li><li>Keep an existing item code to update that service. New codes are kept; blank codes are generated automatically.</li><li>Enter 10 for a 10% pool rate. Employee payment columns use fixed amounts per unit; Yes under Include Photo ($57.50) adds a separate $57.50 Photo line per unit to new bills; its selected employee earns $4.50 per unit.</li><li>For an activity with no commissions, choose No pool, leave employee payments blank, and set Include Photo ($57.50) to No.</li><li>Upload the file and review the proposed changes before saving.</li></ol><p>Changes affect this property only. Saved bill prices and protected pool rules are retained. Older catalogue exports are still accepted.</p></details>
    {busy && <p role="status" className="catalogue-transfer-status">Processing your catalogue file…</p>}
  </section>;
};
