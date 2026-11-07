import { useEffect, useRef } from 'react';
import { TableScroll } from '../TableScroll';
import { formatMoney, formatUnitPrice } from '../../utils/format';
import { Modal } from '../Modal';
import { displayDate } from '../../utils/dates';
import { electronicDocumentNotice } from '../../utils/documentNotice';

import { CalendarDays, RotateCcw, Trash2, Printer, Receipt } from 'lucide-react';
import type { BillsModel } from './useBillsController';

export function BillDetails({ model, inline = false }: { model: BillsModel; inline?: boolean }) {
  const {
    actionLoading, canEdit, closeBillDetails, currencySymbol,
    editMonth, errorMsg, selectedBill, setDeleteModalOpen,
    setEditingBill, setErrorMsg, setNewRedateDate, setRebateModalOpen,
    setRedateModalOpen,
  } = model;
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!inline || !selectedBill || !pane.current) return;
    pane.current.scrollTop = 0;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) pane.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [inline, selectedBill?.id]);
  const content = selectedBill && (
          <div className={`bill-receipt-document ${inline ? 'bill-reading-content space-y-5' : 'bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto'}`}>
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Check #{selectedBill.checkNumber}
                  </h3>
                  {selectedBill.status === 'ACTIVE' ? (
                    <span className="px-2 py-0.5 rounded-full text-sm font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      Active
                    </span>
                  ) : selectedBill.status === 'REBATED' ? (
                    <span className="px-2 py-0.5 rounded-full text-sm font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Rebated
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-sm font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                      Soft Deleted
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Business Date: <strong>{displayDate(selectedBill.businessDate)}</strong> • Created by {selectedBill.createdBy?.name || 'Staff'}
                </p>
              </div>

              <button
                type="button" aria-label="Close bill details" disabled={actionLoading} onClick={closeBillDetails}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            {/* Rebate reason callout if rebated */}
            {selectedBill.status === 'REBATED' && selectedBill.rebateReason && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
                <strong>Rebate Reason:</strong> {selectedBill.rebateReason} (Note: a rebated bill earns no staff commission).
              </div>
            )}

            {/* Guest Summary Card */}
            <div className="bill-receipt-guest grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl text-sm">
              <div>
                <span className="text-slate-400 block font-medium">Room #</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {selectedBill.roomNumber}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Guest Name</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {selectedBill.guestName}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Nationality</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {selectedBill.nationality}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Departure Date</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {selectedBill.departureDate || 'N/A'}
                </span>
              </div>
            </div>

            {/* Items Table */}
            <div className="space-y-2">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Line Items Breakdown
              </h4>
              <TableScroll label="Bill activities" className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-sm receipt-lines-table">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-bold">
                      <th className="py-2.5 px-3">Item</th>
                      <th className="py-2.5 px-3">Qty</th>
                      <th className="py-2.5 px-3">Unit Price</th>
                      <th className="py-2.5 px-3">Disc%</th>
                      <th className="py-2.5 px-3 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedBill.items.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {line.itemName}
                          </div>
                          {/* Personal commission credits */}
                          <div className="flex flex-wrap gap-2 text-xs text-purple-600 dark:text-purple-400 mt-0.5">
                            {line.sellerStaff && <span>Seller: {line.sellerStaff.name}</span>}
                            {line.guideStaff && <span>Guide: {line.guideStaff.name}</span>}
                            {line.instructorCredits?.length ? line.instructorCredits.map(credit => credit.staff && <span key={credit.staffId}>Inst: {credit.staff.name}</span>) : line.instructorStaff && <span>Inst: {line.instructorStaff.name}</span>}
                            {line.photoCredits?.length ? line.photoCredits.map(credit => credit.staff && <span key={credit.staffId}>Photo: {credit.staff.name}</span>) : line.photoStaff && <span>{line.includesComplimentaryMedia ? 'Photo / video' : 'Photo'}: {line.photoStaff.name}</span>}
                            {line.videoStaff && <span>Video: {line.videoStaff.name}</span>}
                            {(line.storeAttendantPoolAmount ?? 0) > 0 && <span>Store attendants · 5% shared: {formatMoney(line.storeAttendantPoolAmount!, currencySymbol)}</span>}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono">{line.quantity}</td>
                        <td className="py-2.5 px-3 font-mono">
                          {formatUnitPrice(line.unitPrice, currencySymbol)}
                        </td>
                        <td className="py-2.5 px-3 font-mono">{line.discountPercent}%</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-right">
                          {formatMoney(line.lineTotal, currencySymbol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            {/* Calculations Breakdown */}
            <div className="bill-receipt-totals bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Gross:</span>
                <span className="font-mono font-semibold">{formatMoney(selectedBill.grossAmount, currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-amber-600">
                <span>Discount:</span>
                <span className="font-mono font-semibold">-{formatMoney(selectedBill.discountAmount, currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Service Charge:</span>
                <span className="font-mono font-semibold">+{formatMoney(selectedBill.serviceChargeAmount, currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Tax / TGST:</span>
                <span className="font-mono font-semibold">+{formatMoney(selectedBill.taxAmount, currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-emerald-600">
                <span>Tip:</span>
                <span className="font-mono font-semibold">+{formatMoney(selectedBill.tipAmount, currencySymbol)}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between text-sm font-bold">
                <span>Net Total:</span>
                <span className="text-sky-600 dark:text-sky-400 font-mono text-base font-bold">
                  {formatMoney(selectedBill.netAmount, currencySymbol)}
                </span>
              </div>
            </div>

            <p className="document-generation-notice">{electronicDocumentNotice}</p>
            {/* Actions Toolbar per PDF Page 4: Re-date, Rebate, Delete */}
            <div className="bill-receipt-actions pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 justify-between items-center">
              <div className="flex space-x-2">
                {selectedBill.status === 'ACTIVE' && (
                  <>
                    {canEdit && <button type="button" className="secondary-button" disabled={editMonth.locked !== false} title={editMonth.locked ? 'This payroll month is locked.' : editMonth.error || 'Edit this posted bill'} onClick={() => setEditingBill(selectedBill)}>Edit bill</button>}
                    {canEdit && editMonth.error && <button type="button" className="text-button" onClick={editMonth.retry}>Retry payroll check</button>}
                    {/* Re-date button */}
                    <button
                      onClick={() => {
                        setNewRedateDate(selectedBill.businessDate);
                        setRedateModalOpen(true);
                      }}
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300 transition flex items-center space-x-1.5"
                    >
                      <CalendarDays className="w-3.5 h-3.5 text-sky-500" />
                      <span>Re-date</span>
                    </button>

                    {/* Rebate button */}
                    <button
                      onClick={() => setRebateModalOpen(true)}
                      className="px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-sm font-semibold text-amber-700 dark:text-amber-400 transition flex items-center space-x-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                      <span>Rebate</span>
                    </button>

                    {/* Soft Delete button */}
                    <button
                      onClick={() => setDeleteModalOpen(true)}
                      className="px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-sm font-semibold text-rose-700 dark:text-rose-400 transition flex items-center space-x-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold hover:bg-slate-800 dark:hover:bg-slate-100 transition flex items-center space-x-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Bill</span>
              </button>
            </div>
          </div>
  );
  if (inline) return <section id="bill-reading-pane" ref={pane} className="bill-reading-pane" aria-label="Selected bill details" aria-busy={model.detailLoading}>
    {model.detailLoading ? <div className="bill-reading-empty" role="status">Loading bill details…</div> : model.detailError ? <div className="bill-reading-empty" role="alert"><p>{model.detailError}</p><button type="button" className="text-button" onClick={() => model.selectedBillId && model.openBillDetails(model.selectedBillId)}>Retry bill details</button></div> : content || <div className="bill-reading-empty"><Receipt size={32} /><h2>Select a bill</h2><p>Choose a bill from the list to view its items, totals and actions.</p></div>}
  </section>;
  return selectedBill ? <Modal label="Bill details" onClose={() => { if (!actionLoading) { closeBillDetails(); setErrorMsg(null); } }} busy={actionLoading} error={errorMsg}>{content}</Modal> : null;
}
