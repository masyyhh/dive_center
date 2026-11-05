import { useAuth } from '../../context/AuthContext';
import { useMonthLock } from '../../hooks/useMonthLock';
import { investigationPeriod } from '../../utils/dashboardNavigation';
import { businessToday, isBusinessDate } from '../../utils/dates';
import React, { useState, useEffect, useRef } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { apiFetch } from '../../services/api';
import { isSiyamWorld } from '../../utils/propertyPresentation';
import { Bill } from '../../types';

export interface BillsViewProps {
  section?: string;
  savedCheck: number | null;
  onDismissSaved: () => void;
  onSetup: () => void;
}

export function useBillsController({ section, savedCheck, onDismissSaved, onSetup }: BillsViewProps) {
  const { activeProperty } = useProperty();
  const splitView = isSiyamWorld(activeProperty);
  const { user } = useAuth();
  const canEdit = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [editSuccess, setEditSuccess] = useState('');
  useEffect(() => { setEditingBill(null); closeBillDetails(); }, [activeProperty?.id]);

  const initialPeriod = investigationPeriod(section);
  const [discountedOnly, setDiscountedOnly] = useState(!splitView && (initialPeriod?.discountedOnly || false));
  // Filters
  const [startDate, setStartDate] = useState<string>(
    initialPeriod?.startDate || `${businessToday().slice(0, 7)}-01`
  );
  const [endDate, setEndDate] = useState<string>(
    initialPeriod?.endDate || businessToday()
  );
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'REBATED' | 'DELETED'>(initialPeriod ? 'ACTIVE' : 'ALL');

  useEffect(() => {
    const period = investigationPeriod(section);
    if (period) { setStartDate(period.startDate); setEndDate(period.endDate); setStatusFilter('ACTIVE'); setDiscountedOnly(!splitView && period.discountedOnly); setSearch(''); }
  }, [section, splitView]);

  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected bill for detailed modal
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const editMonth = useMonthLock(activeProperty?.id, selectedBill?.businessDate.slice(0, 7) || '');
  const detailRequest = useRef(0);
  const closeBillDetails = () => { detailRequest.current++; setSelectedBill(null); setSelectedBillId(null); setDetailLoading(false); setDetailError(''); };
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
  const resetFilters = () => { setResetVersion(v => v + 1); setSearch(''); setStatusFilter('ALL'); setDiscountedOnly(false); setStartDate(`${businessToday().slice(0, 7)}-01`); setEndDate(businessToday()); };
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
    if (actionLoading) return;
    const request = ++detailRequest.current;
    setSelectedBillId(billId);
    setDetailLoading(true);
    setDetailError('');
    if (splitView) setSelectedBill(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ bill: Bill }>(`/bills/${billId}`);
      if (request !== detailRequest.current) return;
      setSelectedBill(res.bill);
    } catch (err) {
      if (request !== detailRequest.current) return;
      const message = err instanceof Error ? err.message : 'Could not open this bill.';
      if (splitView) setDetailError(message); else setErrorMsg(message);
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
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
  const visibleBills = !splitView && discountedOnly ? bills.filter(bill => bill.discountAmount > 0) : bills;
  useEffect(() => {
    if (splitView && !loading && selectedBillId && !visibleBills.some(bill => bill.id === selectedBillId)) closeBillDetails();
  }, [splitView, loading, bills, discountedOnly, selectedBillId]);

  return {
    actionLoading,
    canEdit,
    closeBillDetails,
    currencySymbol,
    deleteModalOpen,
    detailError,
    detailLoading,
    discountedOnly,
    editMonth,
    editSuccess,
    editingBill,
    endDate,
    errorMsg,
    fetchBills,
    handleDelete,
    handleRebate,
    handleRedate,
    handleSearchSubmit,
    loading,
    newRedateDate,
    onDismissSaved,
    onSetup,
    openBillDetails,
    rebateModalOpen,
    rebateReason,
    redateModalOpen,
    resetFilters,
    savedCheck,
    search,
    selectedBill,
    selectedBillId,
    splitView,
    setDeleteModalOpen,
    setDiscountedOnly,
    setEditSuccess,
    setEditingBill,
    setEndDate,
    setErrorMsg,
    setNewRedateDate,
    setRebateModalOpen,
    setRebateReason,
    setRedateModalOpen,
    setSearch,
    setStartDate,
    setStatusFilter,
    startDate,
    statusFilter,
    visibleBills
  };
}

export type BillsModel = ReturnType<typeof useBillsController>;
