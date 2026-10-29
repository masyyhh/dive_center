import { formatMoney } from '../utils/format';
import { Modal } from './Modal';
import { businessToday, displayDate, isBusinessDate } from '../utils/dates';
import React, { useState, useEffect, useRef } from 'react';
import { useProperty } from '../context/PropertyContext';
import { apiFetch } from '../services/api';
import { Bill } from '../types';
import {
  Search,
  Calendar,
  Filter,
  Eye,
  CalendarDays,
  RotateCcw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  FileText,
  User,
  Clock,
  Printer,
} from 'lucide-react';

export const BillsView: React.FC<{ savedCheck: number | null; onDismissSaved: () => void }> = ({ savedCheck, onDismissSaved }) => {
  const { activeProperty } = useProperty();

  // Filters
  const [startDate, setStartDate] = useState<string>(
    `${businessToday().slice(0, 7)}-01`
  );
  const [endDate, setEndDate] = useState<string>(
    businessToday()
  );
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'REBATED' | 'DELETED'>('ALL');

  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected bill for detailed modal
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const detailRequest = useRef(0);
  const closeBillDetails = () => { detailRequest.current++; setSelectedBill(null); };
  useEffect(() => () => { detailRequest.current++; }, []);

  // Action Modals
  const [redateModalOpen, setRedateModalOpen] = useState<boolean>(false);
  const [newRedateDate, setNewRedateDate] = useState<string>('');

  const [rebateModalOpen, setRebateModalOpen] = useState<boolean>(false);
  const [rebateReason, setRebateReason] = useState<string>('');

  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const requestVersion = useRef(0);
  const [resetVersion, setResetVersion] = useState(0);
  const resetFilters = () => { setResetVersion(v => v + 1); setSearch(''); setStatusFilter('ALL'); setStartDate(`${businessToday().slice(0, 7)}-01`); setEndDate(businessToday()); };
  const fetchBills = async () => {
    if (!activeProperty) return;
    const request = ++requestVersion.current;
    if (!isBusinessDate(startDate) || !isBusinessDate(endDate) || startDate > endDate) { setErrorMsg('Choose a valid date range. The start date must be on or before the end date.'); setBills([]); setLoading(false); return; }
    try {
      setLoading(true);
      setErrorMsg(null);
      let query = `/bills?propertyId=${activeProperty.id}&startDate=${startDate}&endDate=${endDate}`;
      if (statusFilter !== 'ALL') {
        query += `&status=${statusFilter}`;
      }
      if (search.trim()) {
        query += `&search=${encodeURIComponent(search.trim())}`;
      }

      const res = await apiFetch<{ bills: Bill[] }>(query);
      if (request !== requestVersion.current) return;
      setBills(res.bills);
    } catch (err: any) {
      if (request !== requestVersion.current) return;
      setBills([]);
      setErrorMsg(err.message || 'Failed to load bills.');
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchBills();
    return () => { requestVersion.current++; };
  }, [activeProperty, startDate, endDate, statusFilter, resetVersion]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchBills();
  };

  const openBillDetails = async (billId: string) => {
    const request = ++detailRequest.current;
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ bill: Bill }>(`/bills/${billId}`);
      if (request !== detailRequest.current) return;
      setSelectedBill(res.bill);
    } catch (err) {
      if (request !== detailRequest.current) return;
      setErrorMsg(err instanceof Error ? err.message : 'Could not open this bill.');
    }
  };

  // Re-date Bill (PDF Page 4)
  const handleRedate = async () => {
    if (!selectedBill || !newRedateDate) return;
    try {
      setActionLoading(true);
      await apiFetch(`/bills/${selectedBill.id}/re-date`, {
        method: 'POST',
        body: JSON.stringify({ newDate: newRedateDate }),
      });
      setRedateModalOpen(false);
      openBillDetails(selectedBill.id);
      fetchBills();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to re-date bill.');
    } finally {
      setActionLoading(false);
    }
  };

  // Rebate Bill (PDF Page 4)
  const handleRebate = async () => {
    if (!selectedBill || !rebateReason.trim()) return;
    try {
      setActionLoading(true);
      await apiFetch(`/bills/${selectedBill.id}/rebate`, {
        method: 'POST',
        body: JSON.stringify({ reason: rebateReason.trim() }),
      });
      setRebateModalOpen(false);
      setRebateReason('');
      openBillDetails(selectedBill.id);
      fetchBills();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to rebate bill.');
    } finally {
      setActionLoading(false);
    }
  };

  // Soft Delete Bill (PDF Page 4)
  const handleDelete = async () => {
    if (!selectedBill) return;
    try {
      setActionLoading(true);
      await apiFetch(`/bills/${selectedBill.id}`, {
        method: 'DELETE',
      });
      setDeleteModalOpen(false);
      closeBillDetails();
      fetchBills();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete bill.');
    } finally {
      setActionLoading(false);
    }
  };

  const currencySymbol = activeProperty?.currencySymbol || '$';

  return (
    <div className="space-y-6">
      {savedCheck !== null && <div className="notice notice-success" role="status"><CheckCircle2 size={18} /><span>Bill #{savedCheck} saved successfully. Find it by its business date below.</span><button onClick={onDismissSaved}>Dismiss</button></div>}
      {/* Top Filter Card */}
      <div className="feature-controls bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Receipt className="w-5 h-5 text-sky-500" />
              <span>Bills</span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Find guest checks, review details, and keep a clear correction trail.
            </p>
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center space-x-2 text-sm">
            <button
              onClick={() => {
                const today = businessToday();
                setStartDate(today);
                setEndDate(today);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-semibold transition"
            >
              Today
            </button>
            <button
              onClick={() => {
                const ym = new Date().toISOString().substring(0, 7);
                setStartDate(`${ym}-01`);
                setEndDate(businessToday());
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-semibold transition"
            >
              This Month
            </button>
          </div>
        </div>

        {/* Filter controls */}
        <div className="bill-filters grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 text-sm">
          {/* Search Box */}
          <form onSubmit={handleSearchSubmit} className="bill-search-form">
            <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search bills"
              placeholder="Check, guest or room"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            </div><button className="primary-button" type="submit" disabled={loading}>Search</button>
          </form>

          {/* Start Date */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">From:</span>
            <input
              type="date"
              aria-label="Bills from date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* End Date */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">To:</span>
            <input
              type="date"
              aria-label="Bills to date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(['ALL', 'ACTIVE', 'REBATED', 'DELETED'] as const).map((st) => (
              <button
                key={st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
                onClick={() => setStatusFilter(st)}
                aria-pressed={statusFilter === st}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition ${
                  statusFilter === st
                    ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {errorMsg && <div role="alert" className="notice notice-error"><AlertTriangle size={18} /><span>{errorMsg}</span><button onClick={fetchBills}>Try again</button></div>}
      <div className="results-toolbar"><p role="status">{loading ? 'Finding bills…' : `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} found`}<span> · {startDate && endDate ? `${displayDate(startDate)} – ${displayDate(endDate)}` : 'Select dates'}</span></p><button className="secondary-button" onClick={resetFilters}>Reset filters</button></div>
      {/* Bills Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-400">Loading bills...</div>
        ) : bills.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            <Receipt className="mx-auto mb-4 text-sky-600" size={30} /><strong className="block text-base mb-2 text-slate-800 dark:text-slate-200">No bills match your filters</strong><p>Try another guest, room, check number, or date range.</p><button className="text-button mt-4" onClick={resetFilters}>Reset filters</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Check #</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Guest Name</th>
                  <th className="py-3 px-4 font-semibold text-slate-900 dark:text-white">Net Total</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {bills.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => openBillDetails(b.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-sky-600 dark:text-sky-400">
                      <button className="text-button" aria-label={`View bill ${b.checkNumber}`} onClick={event => { event.stopPropagation(); openBillDetails(b.id); }}>#{b.checkNumber}</button>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-300">
                      {displayDate(b.businessDate)}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                      Room {b.roomNumber}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                      {b.guestName}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                      {formatMoney(b.netAmount, currencySymbol)}
                    </td>
                    <td className="py-3 px-4">
                      {b.status === 'ACTIVE' ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          Active
                        </span>
                      ) : b.status === 'REBATED' ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Rebated
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          Deleted
                        </span>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bill Details Modal (Printable receipt + Re-date, Rebate, Delete actions) */}
      {selectedBill && (
        <Modal label="Bill details" onClose={() => { if (!actionLoading) { closeBillDetails(); setErrorMsg(null); } } } busy={actionLoading} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
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
                onClick={closeBillDetails}
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl text-sm">
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
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
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
                            {line.instructorStaff && <span>Inst: {line.instructorStaff.name}</span>}
                            {line.photoStaff && <span>Photo: {line.photoStaff.name}</span>}
                            {line.videoStaff && <span>Video: {line.videoStaff.name}</span>}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono">{line.quantity}</td>
                        <td className="py-2.5 px-3 font-mono">
                          {formatMoney(line.unitPrice, currencySymbol)}
                        </td>
                        <td className="py-2.5 px-3 font-mono">{line.discountPercent}%</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-right">
                          {formatMoney(line.lineTotal, currencySymbol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Calculations Breakdown */}
            <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl space-y-1.5 text-sm">
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

            {/* Actions Toolbar per PDF Page 4: Re-date, Rebate, Delete */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 justify-between items-center">
              <div className="flex space-x-2">
                {selectedBill.status === 'ACTIVE' && (
                  <>
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
        </Modal>
      )}

      {/* Re-date Action Modal */}
      {redateModalOpen && selectedBill && (
        <Modal label="Change business date" onClose={() => { if (!actionLoading) { setRedateModalOpen(false); setErrorMsg(null); } } } busy={actionLoading} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <CalendarDays className="w-4 h-4 text-sky-500" />
              <span>Re-date Check #{selectedBill.checkNumber}</span>
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Move this bill to a different business date. The check number stays the same and an entry is logged in the change log.
            </p>

            <div>
              <label htmlFor="billsview-field-1" className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">
                New Business Date:
              </label>
              <input id="billsview-field-1"
                type="date"
                value={newRedateDate}
                onChange={(e) => setNewRedateDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRedateModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !newRedateDate}
                onClick={handleRedate}
                className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold transition"
              >
                {actionLoading ? 'Saving...' : 'Apply Re-date'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rebate Action Modal */}
      {rebateModalOpen && selectedBill && (
        <Modal label="Rebate bill" onClose={() => { if (!actionLoading) { setRebateModalOpen(false); setErrorMsg(null); } } } busy={actionLoading} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <RotateCcw className="w-4 h-4 text-amber-500" />
              <span>Rebate Check #{selectedBill.checkNumber}</span>
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Reversing this bill zeroes out all staff commissions for this check. The original bill stays on record for audit trails.
            </p>

            <div>
              <label htmlFor="billsview-field-2" className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Reason for Rebate *
              </label>
              <textarea id="billsview-field-2"
                rows={3}
                value={rebateReason}
                onChange={(e) => setRebateReason(e.target.value)}
                placeholder="e.g. Guest had medical issue; dive refunded per doctor note."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRebateModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !rebateReason.trim()}
                onClick={handleRebate}
                className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition"
              >
                {actionLoading ? 'Processing...' : 'Confirm Rebate'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Action Modal */}
      {deleteModalOpen && selectedBill && (
        <Modal label="Delete bill" onClose={() => { if (!actionLoading) { setDeleteModalOpen(false); setErrorMsg(null); } } } busy={actionLoading} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Trash2 className="w-4 h-4 text-rose-500" />
              <span>Soft-Delete Check #{selectedBill.checkNumber}?</span>
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Soft deleting removes this bill from revenue totals and frees check number <strong>#{selectedBill.checkNumber}</strong> so it can be reused. It will remain in administrator history.
            </p>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleDelete}
                className="flex-1 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold transition"
              >
                {actionLoading ? 'Deleting...' : 'Confirm Soft Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
