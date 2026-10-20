import React, { useState, useEffect } from 'react';
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

export const BillsView: React.FC = () => {
  const { activeProperty } = useProperty();

  // Filters
  const [startDate, setStartDate] = useState<string>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10)
  );
  const [endDate, setEndDate] = useState<string>(
    new Date().toISOString().substring(0, 10)
  );
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'REBATED' | 'DELETED'>('ALL');

  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected bill for detailed modal
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);

  // Action Modals
  const [redateModalOpen, setRedateModalOpen] = useState<boolean>(false);
  const [newRedateDate, setNewRedateDate] = useState<string>('');

  const [rebateModalOpen, setRebateModalOpen] = useState<boolean>(false);
  const [rebateReason, setRebateReason] = useState<string>('');

  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const fetchBills = async () => {
    if (!activeProperty) return;
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
      setBills(res.bills);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load bills.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBills();
  }, [activeProperty, startDate, endDate, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchBills();
  };

  const openBillDetails = async (billId: string) => {
    try {
      const res = await apiFetch<{ bill: Bill }>(`/bills/${billId}`);
      setSelectedBill(res.bill);
    } catch (err) {
      console.error('Failed to get bill details:', err);
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
      alert(err.message || 'Failed to re-date bill.');
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
      alert(err.message || 'Failed to rebate bill.');
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
      setSelectedBill(null);
      fetchBills();
    } catch (err: any) {
      alert(err.message || 'Failed to delete bill.');
    } finally {
      setActionLoading(false);
    }
  };

  const currencySymbol = activeProperty?.currencySymbol || '$';

  return (
    <div className="space-y-6">
      {/* Top Filter Card */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Receipt className="w-5 h-5 text-sky-500" />
              <span>Bills & Checks</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Review, re-date, rebate, or soft-delete bills for {activeProperty?.name}.
            </p>
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center space-x-2 text-xs">
            <button
              onClick={() => {
                const today = new Date().toISOString().substring(0, 10);
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
                setEndDate(new Date().toISOString().substring(0, 10));
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-semibold transition"
            >
              This Month
            </button>
          </div>
        </div>

        {/* Filter controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Search Box */}
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search check #, guest, room..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </form>

          {/* Start Date */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">From:</span>
            <input
              type="date"
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
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(['ALL', 'ACTIVE', 'REBATED', 'DELETED'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition ${
                  statusFilter === st
                    ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bills Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading bills...</div>
        ) : bills.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">
            No bills found matching current filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Check #</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Guest Name</th>
                  <th className="py-3 px-4">Nationality</th>
                  <th className="py-3 px-4">Gross</th>
                  <th className="py-3 px-4">SC</th>
                  <th className="py-3 px-4">Tax</th>
                  <th className="py-3 px-4">Tip</th>
                  <th className="py-3 px-4 font-extrabold text-slate-900 dark:text-white">Net Total</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
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
                      #{b.checkNumber}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-300">
                      {b.businessDate}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                      Room {b.roomNumber}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                      {b.guestName}
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {b.nationality}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.grossAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.serviceChargeAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.taxAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.tipAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono font-extrabold text-slate-900 dark:text-white">
                      {currencySymbol}{b.netAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      {b.status === 'ACTIVE' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          Active
                        </span>
                      ) : b.status === 'REBATED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Rebated
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          Deleted
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openBillDetails(b.id);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 font-semibold transition inline-flex items-center space-x-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>
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
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Check #{selectedBill.checkNumber}
                  </h3>
                  {selectedBill.status === 'ACTIVE' ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      Active
                    </span>
                  ) : selectedBill.status === 'REBATED' ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Rebated
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                      Soft Deleted
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Business Date: <strong>{selectedBill.businessDate}</strong> • Created by {selectedBill.createdBy?.name || 'Staff'}
                </p>
              </div>

              <button
                onClick={() => setSelectedBill(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            {/* Rebate reason callout if rebated */}
            {selectedBill.status === 'REBATED' && selectedBill.rebateReason && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                <strong>Rebate Reason:</strong> {selectedBill.rebateReason} (Note: a rebated bill earns no staff commission).
              </div>
            )}

            {/* Guest Summary Card */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl text-xs">
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
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Line Items Breakdown
              </h4>
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
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
                          <div className="flex flex-wrap gap-2 text-[10px] text-purple-600 dark:text-purple-400 mt-0.5">
                            {line.sellerStaff && <span>Seller: {line.sellerStaff.name}</span>}
                            {line.guideStaff && <span>Guide: {line.guideStaff.name}</span>}
                            {line.instructorStaff && <span>Inst: {line.instructorStaff.name}</span>}
                            {line.photoStaff && <span>Photo: {line.photoStaff.name}</span>}
                            {line.videoStaff && <span>Video: {line.videoStaff.name}</span>}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono">{line.quantity}</td>
                        <td className="py-2.5 px-3 font-mono">
                          {currencySymbol}{line.unitPrice.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 font-mono">{line.discountPercent}%</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-right">
                          {currencySymbol}{line.lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Calculations Breakdown */}
            <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Gross:</span>
                <span className="font-mono font-semibold">{currencySymbol}{selectedBill.grossAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-600">
                <span>Discount:</span>
                <span className="font-mono font-semibold">-{currencySymbol}{selectedBill.discountAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Service Charge:</span>
                <span className="font-mono font-semibold">+{currencySymbol}{selectedBill.serviceChargeAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Tax / TGST:</span>
                <span className="font-mono font-semibold">+{currencySymbol}{selectedBill.taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-emerald-600">
                <span>Tip:</span>
                <span className="font-mono font-semibold">+{currencySymbol}{selectedBill.tipAmount.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between text-sm font-bold">
                <span>Net Total:</span>
                <span className="text-sky-600 dark:text-sky-400 font-mono text-base font-black">
                  {currencySymbol}{selectedBill.netAmount.toFixed(2)}
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
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition flex items-center space-x-1.5"
                    >
                      <CalendarDays className="w-3.5 h-3.5 text-sky-500" />
                      <span>Re-date</span>
                    </button>

                    {/* Rebate button */}
                    <button
                      onClick={() => setRebateModalOpen(true)}
                      className="px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-xs font-semibold text-amber-700 dark:text-amber-400 transition flex items-center space-x-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                      <span>Rebate</span>
                    </button>

                    {/* Soft Delete button */}
                    <button
                      onClick={() => setDeleteModalOpen(true)}
                      className="px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-xs font-semibold text-rose-700 dark:text-rose-400 transition flex items-center space-x-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:bg-slate-800 dark:hover:bg-slate-100 transition flex items-center space-x-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Bill</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-date Action Modal */}
      {redateModalOpen && selectedBill && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <CalendarDays className="w-4 h-4 text-sky-500" />
              <span>Re-date Check #{selectedBill.checkNumber}</span>
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Move this bill to a different business date. The check number stays the same and an entry is logged in the change log.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                New Business Date:
              </label>
              <input
                type="date"
                value={newRedateDate}
                onChange={(e) => setNewRedateDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRedateModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !newRedateDate}
                onClick={handleRedate}
                className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition"
              >
                {actionLoading ? 'Saving...' : 'Apply Re-date'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rebate Action Modal */}
      {rebateModalOpen && selectedBill && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <RotateCcw className="w-4 h-4 text-amber-500" />
              <span>Rebate Check #{selectedBill.checkNumber}</span>
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reversing this bill zeroes out all staff commissions for this check. The original bill stays on record for audit trails.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Reason for Rebate *
              </label>
              <textarea
                rows={3}
                value={rebateReason}
                onChange={(e) => setRebateReason(e.target.value)}
                placeholder="e.g. Guest had medical issue; dive refunded per doctor note."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRebateModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !rebateReason.trim()}
                onClick={handleRebate}
                className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition"
              >
                {actionLoading ? 'Processing...' : 'Confirm Rebate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Action Modal */}
      {deleteModalOpen && selectedBill && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Trash2 className="w-4 h-4 text-rose-500" />
              <span>Soft-Delete Check #{selectedBill.checkNumber}?</span>
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Soft deleting removes this bill from revenue totals and frees check number <strong>#{selectedBill.checkNumber}</strong> so it can be reused. It will remain in administrator history.
            </p>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleDelete}
                className="flex-1 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition"
              >
                {actionLoading ? 'Deleting...' : 'Confirm Soft Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
