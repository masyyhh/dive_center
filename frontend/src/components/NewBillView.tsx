import { nationalityCountries as countries } from '../utils/nationalities';
import { addActivityWithPhoto, normalizeAutomaticPhotos, removeActivityWithPhoto, updateLinkedQuantity } from '../utils/automaticPhotos';
import { guestBillFields } from '../utils/pmsGuests';
import { useMonthLock } from '../hooks/useMonthLock';
import { formatMoney } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { useUnsavedChanges } from '../context/NavigationContext';
import { BillDraft, billDraftKey, loadBillDraft } from '../utils/billDraft';
import { Modal } from './Modal';
import { businessToday, displayDate, isBusinessDate } from '../utils/dates';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useProperty } from '../context/PropertyContext';
import { apiFetch, ApiError } from '../services/api';
import { Item, Category, StaffMember, BillItem, PmsGuest } from '../types';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Info,
  DollarSign,
  UserCheck,
  ChevronRight,
  Receipt,
} from 'lucide-react';

interface NewBillViewProps {
  onBillSaved: (checkNumber: number) => void;
  onSetup: () => void;
}

export const NewBillView: React.FC<NewBillViewProps> = ({ onBillSaved, onSetup }) => {
  const { activeProperty } = useProperty();
  const { user } = useAuth();
  const canManage = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const draftKey = billDraftKey(user?.id || '', activeProperty?.id || '');
  const restoredDraft = useMemo(() => loadBillDraft(draftKey), [draftKey]);
  const [restored, setRestored] = useState(Boolean(restoredDraft));
  const [draftError, setDraftError] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [attemptedReview, setAttemptedReview] = useState(false);
  const [checkEdited, setCheckEdited] = useState(restoredDraft?.checkEdited || false);
  const [nextCheck, setNextCheck] = useState(1001);

  // Catalogue state
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffNotice, setStaffNotice] = useState('');
  const [loadedStaffKey, setLoadedStaffKey] = useState('');
  const [staffReload, setStaffReload] = useState(0);

  // Bill state
  const [checkNumber, setCheckNumber] = useState<number>(restoredDraft?.checkNumber ?? 1001);
  const [businessDate, setBusinessDate] = useState<string>(
    restoredDraft?.businessDate ?? businessToday()
  );
  const monthLock = useMonthLock(activeProperty?.id, businessDate.slice(0, 7));
  const [roomNumber, setRoomNumber] = useState<string>(restoredDraft?.roomNumber ?? '');
  const [guestName, setGuestName] = useState<string>(restoredDraft?.guestName ?? '');
  const [departureDate, setDepartureDate] = useState<string>(restoredDraft?.departureDate ?? '');
  const [nationality, setNationality] = useState<string>(restoredDraft?.nationality ?? 'Other');
  const [tipAmount, setTipAmount] = useState<number>(restoredDraft?.tipAmount ?? 0);
  const [tipStaffIds, setTipStaffIds] = useState<string[]>(restoredDraft?.tipStaffIds ?? []);
  const [billLines, setBillLines] = useState<BillItem[]>(restoredDraft?.billLines ?? []);
  const [notes, setNotes] = useState<string>(restoredDraft?.notes ?? '');

  const [pmsGuests, setPmsGuests] = useState<PmsGuest[]>([]);
  const [pmsBusy, setPmsBusy] = useState(false);
  const [pmsMessage, setPmsMessage] = useState('');
  const [pmsError, setPmsError] = useState('');
  const [guestPickerOpen, setGuestPickerOpen] = useState(false);
  const [selectedPmsGuest, setSelectedPmsGuest] = useState<number | null>(null);
  const pmsController = useRef<AbortController | null>(null);
  const pmsGeneration = useRef(0);
  const pmsLookupKey = `${activeProperty?.id || ''}\0${roomNumber.trim()}\0${businessDate}`;
  const currentPmsKey = useRef(pmsLookupKey);
  currentPmsKey.current = pmsLookupKey;
  const cancelPmsLookup = () => { pmsController.current?.abort(); pmsGeneration.current++; };

  // Status & modal state
  const [setupLoading, setSetupLoading] = useState(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const dirty = billLines.length > 0 || Boolean(roomNumber || guestName || departureDate || notes) || nationality !== 'Other' || tipAmount > 0 || tipStaffIds.length > 0 || checkEdited || businessDate !== businessToday();
  const releaseGuard = useUnsavedChanges(dirty, saving ? 'Your bill is being saved. Please wait for confirmation.' : draftError ? 'Your bill has unsaved changes. Draft storage is unavailable; leaving will lose this work.' : 'This bill has not been submitted. Its draft is kept in this browser tab for this account and property.', saving);
  useEffect(() => {
    try {
      if (dirty) {
        const draft: BillDraft = { version: 1, checkNumber, businessDate, roomNumber, guestName, departureDate, nationality, tipAmount, tipStaffIds, billLines, notes, checkEdited };
        sessionStorage.setItem(draftKey, JSON.stringify(draft));
      } else { sessionStorage.removeItem(draftKey); setRestored(false); }
      setDraftError(false);
    } catch { setDraftError(true); }
  }, [draftKey, dirty, checkNumber, businessDate, roomNumber, guestName, departureDate, nationality, tipAmount, tipStaffIds, billLines, notes, checkEdited]);
  const discardDraft = () => {
    setBillLines([]); setRoomNumber(''); setGuestName(''); setDepartureDate(''); setNationality('Other');
    setTipAmount(0); setTipStaffIds([]); setNotes(''); setBusinessDate(businessToday()); setCheckNumber(nextCheck);
    setCheckEdited(false); setRestored(false); setAttemptedReview(false); setErrorMsg(null); setPmsGuests([]); setPmsMessage(''); setPmsError(''); setGuestPickerOpen(false); cancelPmsLookup(); setDiscardOpen(false);
  };
  // Load the catalogue and next check number
  useEffect(() => {
    if (!activeProperty) return;

    const loadData = async () => {
      setSetupLoading(true);
      setErrorMsg(null);
      try {
        const [itemsData, nextCheckData] = await Promise.all([
          apiFetch<{ categories: Category[]; items: Item[] }>(
            `/items?propertyId=${activeProperty.id}`
          ),
          apiFetch<{ nextCheckNumber: number }>(
            `/bills/next-check?propertyId=${activeProperty.id}`
          ),
        ]);

        setCategories(itemsData.categories);
        setItems(itemsData.items);
        setBillLines(lines => normalizeAutomaticPhotos(lines, itemsData.items));
        setNextCheck(nextCheckData.nextCheckNumber);
        if (!restoredDraft) setCheckNumber(nextCheckData.nextCheckNumber);
      } catch (err) {
        setErrorMsg('Unable to load the catalogue. Please reload this page to try again.');
      } finally {
        setSetupLoading(false);
      }
    };

    loadData();
  }, [activeProperty]);

  const staffKey = `${activeProperty?.id || ''}:${businessDate}`;
  const staffReady = !staffLoading && loadedStaffKey === staffKey;
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const loadEligibleStaff = async () => {
      const current = ++generation;
      setStaffLoading(true);
      setStaffList([]);
      if (!activeProperty || !isBusinessDate(businessDate)) return;
      try {
        const { staff } = await apiFetch<{ staff: StaffMember[] }>(`/staff?propertyId=${encodeURIComponent(activeProperty.id)}&creditOnDate=${businessDate}`);
        if (cancelled || current !== generation) return;
        const ids = new Set(staff.map(s => s.id));
        setStaffList(staff);
        setTipStaffIds(previous => previous.filter(id => ids.has(id)));
        setBillLines(previous => previous.map(line => {
          const updated = { ...line };
          for (const role of ['seller', 'guide', 'instructor', 'photo', 'video'] as const) {
            const field = `${role}StaffId` as const;
            if (updated[field] && !ids.has(updated[field]!)) updated[field] = null;
          }
          return updated;
        }));
        setLoadedStaffKey(staffKey);
        setStaffNotice('Only staff employed and not excluded by saved attendance on the business date can receive commission or tips. Unavailable selections are cleared.');
      } catch {
        if (!cancelled && current === generation) {
          setLoadedStaffKey('');
          setStaffNotice('Unable to check staff availability. Retry before saving.');
        }
      } finally {
        if (!cancelled && current === generation) setStaffLoading(false);
      }
    };
    loadEligibleStaff();
    window.addEventListener('focus', loadEligibleStaff);
    return () => { cancelled = true; window.removeEventListener('focus', loadEligibleStaff); };
  }, [activeProperty?.id, businessDate, staffReload]);

  useEffect(() => {
    cancelPmsLookup(); setPmsGuests([]); setPmsMessage(''); setPmsError(''); setGuestPickerOpen(false); setSelectedPmsGuest(null); setPmsBusy(false);
    return cancelPmsLookup;
  }, [roomNumber, activeProperty?.id, businessDate]);

  const lookupGuests = async () => {
    if (!activeProperty || !roomNumber.trim() || saving || pmsBusy) return;
    cancelPmsLookup();
    const controller = new AbortController(); pmsController.current = controller;
    const generation = pmsGeneration.current;
    const key = pmsLookupKey;
    setPmsBusy(true); setPmsMessage(''); setPmsError(''); setPmsGuests([]); setSelectedPmsGuest(null); setGuestPickerOpen(false);
    try {
      const result = await apiFetch<{ guests: PmsGuest[] }>(`/guests/inhouse?propertyId=${encodeURIComponent(activeProperty.id)}&roomNumber=${encodeURIComponent(roomNumber.trim())}`, { signal: controller.signal });
      if (controller.signal.aborted || generation !== pmsGeneration.current || key !== currentPmsKey.current) return;
      setPmsGuests(result.guests);
      if (result.guests.length) setGuestPickerOpen(true);
      else setPmsMessage('No in-house guests were found for this room. You can enter the details manually.');
    } catch (err) {
      if (controller.signal.aborted || generation !== pmsGeneration.current || key !== currentPmsKey.current) return;
      const message = err instanceof Error ? err.message : 'Unable to look up guests. Enter the details manually or try again.';
      setPmsError(message + (err instanceof ApiError && err.requestId ? ` Reference: ${err.requestId}` : ''));
    } finally {
      if (generation === pmsGeneration.current) setPmsBusy(false);
    }
  };
  const applyPmsGuest = () => {
    const guest = selectedPmsGuest === null ? undefined : pmsGuests[selectedPmsGuest];
    if (!guest || guest.roomNumber !== roomNumber.trim()) return;
    const values = guestBillFields(guest);
    setGuestName(values.guestName); setDepartureDate(values.departureDate); setNationality(values.nationality);
    setGuestPickerOpen(false); setPmsMessage(`Loaded ${guest.fullName} from PMS (${guest.propertyCode}). You can edit the details below.`);
  };

  // Included activities add a linked Photo line at $57.50 per service unit.
  const handleAddItem = (item: Item) => {
    try { setBillLines(addActivityWithPhoto(billLines, item, items)); setErrorMsg(null); }
    catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Could not add the activity.'); }
  };

  const updateQuantity = (index: number, delta: number) => setBillLines(lines => updateLinkedQuantity(lines, index, delta, items));

  const updateDiscount = (index: number, discountPercent: number) => {
    const updated = [...billLines];
    const line = updated[index];
    const pct = Math.max(0, Math.min(100, discountPercent));
    const lineGross = line.quantity * line.unitPrice;
    const discount = (lineGross * pct) / 100;
    line.discountPercent = pct;
    line.lineTotal = lineGross - discount;
    setBillLines(updated);
  };

  const updateStaffAssignment = (
    index: number,
    role: 'seller' | 'guide' | 'instructor' | 'photo' | 'video',
    staffId: string
  ) => {
    const updated = [...billLines];
    const line = updated[index];
    if (role === 'seller') line.sellerStaffId = staffId || null;
    if (role === 'guide') line.guideStaffId = staffId || null;
    if (role === 'instructor') line.instructorStaffId = staffId || null;
    if (role === 'photo') line.photoStaffId = staffId || null;
    if (role === 'video') line.videoStaffId = staffId || null;
    setBillLines(updated);
  };

  const removeLine = (index: number) => setBillLines(lines => removeActivityWithPhoto(lines, index));

  // Calculations per PDF Page 3 & 4:
  // Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net
  const scRate = activeProperty?.serviceChargeRate ?? 10.0;
  const taxRate = activeProperty?.taxRate ?? 16.0;

  const grossAmount = billLines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
  const discountAmount = billLines.reduce(
    (acc, l) => acc + (l.unitPrice * l.quantity * l.discountPercent) / 100,
    0
  );
  const netBeforeCharges = grossAmount - discountAmount;
  const serviceChargeAmount = (netBeforeCharges * scRate) / 100;
  const taxAmount = ((netBeforeCharges + serviceChargeAmount) * taxRate) / 100;
  const netTotal = netBeforeCharges + serviceChargeAmount + taxAmount + (Number(tipAmount) || 0);

  const currencySymbol = activeProperty?.currencySymbol || '$';

  // Filter catalogue items
  const filteredItems = items.filter((it) => {
    const matchesCat = selectedCategory === 'ALL' || it.categoryId === selectedCategory;
    const matchesQuery =
      (it.category?.name || categories.find(c => c.id === it.categoryId)?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      searchQuery === '' ||
      it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      it.code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  const handleSaveBill = async () => {
    if (!activeProperty || monthLock.locked !== false) return;
    if (!staffReady) { setErrorMsg('Wait for staff availability to load before saving.'); return; }
    setErrorMsg(null);

    if (!roomNumber.trim()) {
      setErrorMsg('Please enter a room number.');
      return;
    }
    if (!guestName.trim()) {
      setErrorMsg('Please enter a guest name.');
      return;
    }
    if (billLines.length === 0) {
      setErrorMsg('Please add at least one line item to the bill.');
      return;
    }

    try {
      setSaving(true);
      await apiFetch('/bills', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: activeProperty.id,
          checkNumber: Number(checkNumber),
          businessDate,
          guestName: guestName.trim(),
          roomNumber: roomNumber.trim(),
          departureDate: departureDate || null,
          nationality,
          tipAmount: Number(tipAmount) || 0,
          tipStaffIds,
          items: billLines,
          notes,
        }),
      });

      setShowConfirmModal(false);
      try { sessionStorage.removeItem(draftKey); } catch { /* Form remains saved on the server. */ }
      releaseGuard();
      onBillSaved(checkNumber);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save bill.');
    } finally {
      setSaving(false);
    }
  };


  const reviewBill = () => {
    setAttemptedReview(true); setErrorMsg(null);
    if (!isBusinessDate(businessDate)) { document.getElementById('bill-business-date')?.focus(); return; }
    if (!roomNumber.trim() || !guestName.trim()) {
      document.getElementById(!roomNumber.trim() ? 'bill-room' : 'bill-guest')?.focus();
      return;
    }
    if (billLines.length > 200) { setErrorMsg('A bill can contain up to 200 lines, including automatic Photos. Remove an activity before saving.'); return; }
    if (!billLines.length) { document.getElementById('bill-activities')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (monthLock.locked !== false) { setErrorMsg(monthLock.locked ? 'Choose a business date in an open month before saving.' : 'Please wait for payroll status to load, or retry if it failed.'); return; }
    if (!staffReady) { setErrorMsg('Wait for staff availability to load before reviewing.'); return; }
    setShowConfirmModal(true);
  };
  return (
    <div className="space-y-6">
      <div className="workflow-steps" aria-label="Bill workflow"><a href="#bill-activities" onClick={e => { e.preventDefault(); document.getElementById('bill-activities')?.scrollIntoView({ behavior: 'smooth' }); }}><span>1</span>Activities</a><a href="#bill-guest-details" onClick={e => { e.preventDefault(); document.getElementById('bill-room')?.focus(); }}><span>2</span>Guest details</a><button onClick={reviewBill}><span>3</span>Review & save</button></div>
      {(restored || dirty) && <div className="draft-notice" role="status"><span>{draftError ? 'Draft storage unavailable. Keep this screen open until you save.' : restored ? 'Draft restored. Review the guest, check number, and prices before saving.' : 'Draft saved in this browser tab.'}</span><button className="text-button" onClick={() => setDiscardOpen(true)}>Discard draft</button></div>}
      {staffNotice && <div className="notice notice-info" role="status"><span>{staffNotice}</span>{!staffReady && !staffLoading && <button type="button" onClick={() => setStaffReload(value => value + 1)}>Retry staff availability</button>}</div>}
      {/* Top check number stepper bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Receipt className="w-5 h-5 text-sky-500" />
            <span className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Micros Check Number:
            </span>
          </div>

          {/* Stepper (+ / -) to match Micros check per PDF Page 3 */}
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => { setCheckEdited(true); setCheckNumber(prev => Math.max(1, prev - 1)); }}
              className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              title="Decrement check number"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number"
              aria-label="Check number"
              value={checkNumber}
              onChange={e => { setCheckEdited(true); setCheckNumber(Math.max(1, parseInt(e.target.value, 10) || 1)); }}
              className="w-20 text-center font-mono font-bold text-sm bg-transparent text-slate-900 dark:text-white focus:outline-none"
            />
            <button
              onClick={() => { setCheckEdited(true); setCheckNumber(prev => prev + 1); }}
              className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              title="Increment check number"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Business Date Picker */}
        <div className="flex items-center space-x-3 text-sm">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Business Date:</span>
          <input
            type="date"
            id="bill-business-date"
            aria-label="Business date"
            aria-invalid={attemptedReview && !isBusinessDate(businessDate)}
            aria-describedby={attemptedReview && !isBusinessDate(businessDate) ? 'business-date-error' : undefined}
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          />{attemptedReview && !isBusinessDate(businessDate) && <p id="business-date-error" className="field-error">Choose a valid business date.</p>}
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="bill-sticky-summary"><div><span>{billLines.reduce((count, line) => count + (line.autoPhotoFor ? 0 : line.quantity), 0)} {billLines.reduce((count, line) => count + (line.autoPhotoFor ? 0 : line.quantity), 0) === 1 ? 'activity' : 'activities'} · Net total</span><strong>{formatMoney(netTotal, currencySymbol)}</strong></div><button className="primary-button" onClick={reviewBill} disabled={saving || setupLoading}>Review bill<ChevronRight size={16} /></button></div>
      {monthLock.locked && <div className="notice notice-info"><span>This business month is locked for payroll. Your draft can be edited, but choose a date in an open month before saving.</span></div>}
      {monthLock.error && <div role="alert" className="notice notice-error"><span>Could not check payroll status. Your draft is safe; retry before saving.</span><button onClick={monthLock.retry}>Retry</button></div>}
      {/* Two-half layout: Item Catalogue (Left) & Bill Draft (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Half: Item Catalogue */}
        <div id="bill-activities" className="xl:col-span-5 space-y-4 bill-activities">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 catalogue-panel">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                1. Choose activities
              </h2>
              <span className="text-sm text-slate-400">
                {filteredItems.length} items available
              </span>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search catalogue"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search dive, course, or item..."
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Category Chips */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedCategory('ALL')}
                className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${
                  selectedCategory === 'ALL'
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${
                    selectedCategory === c.id
                      ? 'bg-sky-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {setupLoading ? <div className="empty-state" role="status"><p>Loading your catalogue…</p></div> : filteredItems.length === 0 && <div className="empty-state"><Receipt size={28} /><h3>{items.length ? 'No matching activities' : 'Your catalogue is empty'}</h3><p>{items.length ? 'Try another search or category.' : canManage ? 'Add your activities and prices to make this property ready for billing.' : 'Ask your property manager to add activities and prices in Administration → Catalogue.'}</p>{!items.length && canManage && <button className="primary-button" onClick={onSetup}>Set up catalogue</button>}{items.length > 0 && <button className="text-button" onClick={() => { setSearchQuery(''); setSelectedCategory('ALL'); }}>Clear search & filters</button>}</div>}
            {/* Item List */}
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {filteredItems.map((item) => {
                const hasPersonalRoles = item.includesComplimentaryMedia || Boolean(item.personalRoles && item.personalRoles.trim().length > 0);
                return (
                  <button
                    type="button"
                    aria-label={`Add ${item.name} to bill`}
                    key={item.id}
                    onClick={() => handleAddItem(item)}
                    className="catalogue-item p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 hover:border-sky-400 dark:hover:border-sky-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-sky-50/40 dark:hover:bg-sky-950/30 transition cursor-pointer flex items-center justify-between group w-full text-left"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs text-slate-400 font-semibold">
                          {item.code}
                        </span>
                        {hasPersonalRoles && (
                          <span className="catalogue-tag px-1.5 py-0.2 rounded text-xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                            {item.includesComplimentaryMedia ? 'Adds Photo $57.50 · team commission $4.50' : `Commission: ${item.personalRoles}`}
                          </span>
                        )}
                        {item.poolType !== 'NONE' && (
                          <span className="catalogue-tag px-1.5 py-0.2 rounded text-xs font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                            {item.poolType === 'COURSE_POOL' ? `Course Pool ${item.poolContribution}%` : item.poolType === 'CERTIFICATION_POOL' ? 'Certifications Pool' : `Dive Pool ${item.poolContribution}%`}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition">
                        {item.name}
                      </div>
                    </div>

                    <div className="text-right flex items-center space-x-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {formatMoney(item.price, currencySymbol)}
                      </span>
                      <div className="w-6 h-6 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Half: Bill Being Built */}
        <div className="xl:col-span-7 space-y-4">
          {/* Guest Details Section */}
          <div id="bill-guest-details" className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <UserCheck className="w-4 h-4 text-sky-500" />
              <span>2. Guest details</span>
            </h3>

            {pmsMessage && <div className="notice" role="status">{pmsMessage}</div>}
            {pmsError && <div className="notice notice-error" role="alert">{pmsError}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <label htmlFor="bill-room" className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Room Number *
                </label>
                <div className="room-lookup-control">
                <input
                  type="text"
                  id="bill-room"
                  aria-label="Room number"
                  aria-required="true"
                  aria-invalid={attemptedReview && !roomNumber.trim()}
                  aria-describedby={attemptedReview && !roomNumber.trim() ? 'room-error' : undefined}
                  value={roomNumber}
                  onChange={(e) => { cancelPmsLookup(); setRoomNumber(e.target.value); }}
                  placeholder="e.g. 304"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                  <button type="button" className="secondary-button" onClick={lookupGuests} disabled={!roomNumber.trim() || pmsBusy || saving || businessDate !== businessToday()} aria-busy={pmsBusy} aria-label="Look up in-house guests for this room"><Search size={16} />{pmsBusy ? 'Looking up…' : 'Find guests'}</button>
                </div>
                {businessDate !== businessToday() && <p className="field-help">PMS lookup shows guests in-house today. Enter details manually for a different business date.</p>}
                {pmsGuests.length > 0 && <button type="button" className="text-button" disabled={saving} onClick={() => { setSelectedPmsGuest(null); setGuestPickerOpen(true); }}>Choose a guest from this room ({pmsGuests.length})</button>}
                {attemptedReview && !roomNumber.trim() && <p id="room-error" className="field-error">Enter a room number.</p>}
              </div>

              <div>
                <label htmlFor="bill-guest" className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Guest Name *
                </label>
                <input
                  type="text"
                  id="bill-guest"
                  aria-label="Guest name"
                  aria-required="true"
                  aria-invalid={attemptedReview && !guestName.trim()}
                  aria-describedby={attemptedReview && !guestName.trim() ? 'guest-error' : undefined}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Julian Weber"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {attemptedReview && !guestName.trim() && <p id="guest-error" className="field-error">Enter the guest name.</p>}
              </div>

              <div>
                <label htmlFor="newbillview-field-3" className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Departure Date
                </label>
                <input id="newbillview-field-3"
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label htmlFor="newbillview-field-4" className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Nationality
                </label>
                <select id="newbillview-field-4"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">Not provided</option>
                  {nationality && !countries.includes(nationality) && <option value={nationality}>{nationality}</option>}
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Bill Lines Table */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                3. Review bill lines ({billLines.length})
              </h3>
              <span className="text-sm text-slate-400">
                Click items on the left to add
              </span>
            </div>

            {billLines.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                No items added yet. Click an item in the catalogue on the left to add to check #{checkNumber}.
              </div>
            ) : (
              <div className="space-y-3">
                {billLines.map((line, idx) => {
                  let personalRoles: string[] = [];
                  let personalRates: Record<string, number> = {};
                  if (line.personalCommissionsJson) {
                    try {
                      const rates = JSON.parse(line.personalCommissionsJson);
                      if (rates && typeof rates === 'object' && !Array.isArray(rates)) {
                        personalRates = Object.fromEntries(Object.entries(rates).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0));
                        personalRoles = Object.keys(personalRates);
                      }
                    } catch {}
                  }

                  return (
                    <div
                      key={line.clientLineId || idx}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {line.itemName}
                          </span>
                          <span className="text-xs text-slate-400 ml-2">
                            ({line.categoryName})
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(line.autoPhotoFor)}
                          aria-label={line.autoPhotoFor ? 'Photo is linked to its activity' : `Remove ${line.itemName}`}
                          onClick={() => removeLine(idx)}
                          className="p-1 text-slate-400 hover:text-rose-500 transition"
                          title={line.autoPhotoFor ? 'Remove the activity to remove its Photo line' : 'Remove item'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {line.autoPhotoFor && <p className="text-xs text-slate-500">Automatically added with {billLines.find(parent => parent.clientLineId === line.autoPhotoFor)?.itemName}. Quantity follows the activity; choose the team member who took the photo below.</p>}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
                        {/* Quantity Stepper */}
                        <div className="flex items-center space-x-1">
                          <span className="text-slate-400 text-xs">Qty:</span>
                          <button
                            type="button"
                            disabled={Boolean(line.autoPhotoFor)}
                            onClick={() => updateQuantity(idx, -1)}
                            className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-bold font-mono">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            disabled={Boolean(line.autoPhotoFor)}
                            onClick={() => updateQuantity(idx, 1)}
                            className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold"
                          >
                            +
                          </button>
                        </div>

                        {/* Price */}
                        <div>
                          <span className="text-slate-400 text-xs">Price: </span>
                          <span className="font-mono font-semibold">
                            {formatMoney(line.unitPrice, currencySymbol)}
                          </span>
                        </div>

                        {/* Discount (%) */}
                        <div className="flex items-center space-x-1">
                          <span className="text-slate-400 text-xs">Disc%:</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={line.discountPercent}
                            onChange={(e) => updateDiscount(idx, parseFloat(e.target.value) || 0)}
                            className="w-14 px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono text-center focus:outline-none"
                          />
                        </div>

                        {/* Line Total */}
                        <div className="text-right font-semibold text-slate-900 dark:text-white font-mono">
                          {formatMoney(line.lineTotal, currencySymbol)}
                        </div>
                      </div>

                      {/* Personal Commission on a Line (PDF Page 3 & 4) */}
                      {personalRoles.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 bg-purple-500/5 -mx-3 -mb-3 p-3 rounded-b-xl space-y-1.5">
                          <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center space-x-1">
                            <Info className="w-3 h-3" />
                            <span>Credit Staff for Line Commission:</span>
                          </span>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {personalRoles.includes('seller') && (
                              <div>
                                <label htmlFor={`newbillview-field-5-${idx}`} className="block text-xs font-medium text-slate-500">
                                  Seller:
                                </label>
                                <select id={`newbillview-field-5-${idx}`}
                                  disabled={!staffReady || saving}
                                  value={line.sellerStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'seller', e.target.value)}
                                  className="w-full text-xs px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
                                >
                                  <option value="">Select seller...</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.roleTitle})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {personalRoles.includes('guide') && (
                              <div>
                                <label htmlFor={`newbillview-field-6-${idx}`} className="block text-xs font-medium text-slate-500">
                                  Guide / Divemaster:
                                </label>
                                <select id={`newbillview-field-6-${idx}`}
                                  disabled={!staffReady || saving}
                                  value={line.guideStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'guide', e.target.value)}
                                  className="w-full text-xs px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
                                >
                                  <option value="">Select guide...</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.roleTitle})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {personalRoles.includes('instructor') && (
                              <div>
                                <label htmlFor={`newbillview-field-7-${idx}`} className="block text-xs font-medium text-slate-500">
                                  Instructor:
                                </label>
                                <select id={`newbillview-field-7-${idx}`}
                                  disabled={!staffReady || saving}
                                  value={line.instructorStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'instructor', e.target.value)}
                                  className="w-full text-xs px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
                                >
                                  <option value="">Select instructor...</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.roleTitle})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {personalRoles.includes('photo') && (
                              <div>
                                <label htmlFor={`newbillview-field-8-${idx}`} className="block text-xs font-medium text-slate-500">
                                  {line.autoPhotoFor ? 'Team member who took the photo' : 'Photographer'}: {formatMoney(personalRates.photo, activeProperty?.currencySymbol || '$')} per service unit
                                </label>
                                <select id={`newbillview-field-8-${idx}`}
                                  disabled={!staffReady || saving}
                                  value={line.photoStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'photo', e.target.value)}
                                  className="w-full text-xs px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
                                >
                                  <option value="">{line.autoPhotoFor ? 'Select team member...' : 'Select photographer...'}</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.roleTitle})
                                    </option>
                                  ))}
                                </select>
                                {line.photoStaffId && <p className="text-xs text-slate-500 mt-1">Employee payment: {formatMoney(personalRates.photo * line.quantity, activeProperty?.currencySymbol || '$')}. Applies even when the service is complimentary.</p>}
                              </div>
                            )}

                            {personalRoles.includes('video') && (
                              <div>
                                <label htmlFor={`newbillview-field-9-${idx}`} className="block text-xs font-medium text-slate-500">
                                  Videographer: {formatMoney(personalRates.video, activeProperty?.currencySymbol || '$')} per service unit
                                </label>
                                <select id={`newbillview-field-9-${idx}`}
                                  disabled={!staffReady || saving}
                                  value={line.videoStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'video', e.target.value)}
                                  className="w-full text-xs px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
                                >
                                  <option value="">Select videographer...</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.roleTitle})
                                    </option>
                                  ))}
                                </select>
                                {line.videoStaffId && <p className="text-xs text-slate-500 mt-1">Employee payment: {formatMoney(personalRates.video * line.quantity, activeProperty?.currencySymbol || '$')}. Applies even when the service is complimentary.</p>}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tip & Notes */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="newbillview-field-10" className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                    Guest Tip ({currencySymbol})
                  </label>
                  <input id="newbillview-field-10"
                    type="number"
                    min="0"
                    step="0.01"
                    value={tipAmount || ''}
                    onChange={(e) => setTipAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                {tipAmount > 0 && (
                  <div>
                    <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Staff Sharing Tip (split equally)
                    </label>
                    <div className="tip-recipients" role="group" aria-label="Staff sharing tip">
                      {staffList.length ? staffList.map(staff => <label key={staff.id}><input type="checkbox" disabled={!staffReady || saving} checked={tipStaffIds.includes(staff.id)} onChange={e => setTipStaffIds(ids => e.target.checked ? [...ids, staff.id] : ids.filter(id => id !== staff.id))} />{staff.name}</label>) : <p className="text-slate-500">No team members available.</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div><label htmlFor="bill-notes" className="block text-sm mb-1">Notes (optional)</label><textarea id="bill-notes" value={notes} onChange={event => setNotes(event.target.value)} rows={2} className="w-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-lg p-3" /></div>
            {/* Running Totals Breakdown Flow (PDF Page 3) */}
            {/* Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net */}
            <div className="bg-slate-50 dark:bg-slate-800/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-sm">
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>Gross Total</span>
                <span className="font-mono font-medium">{formatMoney(grossAmount, currencySymbol)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>- Total Discount</span>
                  <span className="font-mono font-medium">-{formatMoney(discountAmount, currencySymbol)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>+ Service Charge ({scRate}%)</span>
                <span className="font-mono font-medium">{formatMoney(serviceChargeAmount, currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>+ Tax / TGST ({taxRate}%)</span>
                <span className="font-mono font-medium">{formatMoney(taxAmount, currencySymbol)}</span>
              </div>
              {tipAmount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>+ Guest Tip</span>
                  <span className="font-mono font-medium">+{formatMoney(tipAmount, currencySymbol)}</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-sm">
                <span className="font-semibold text-slate-900 dark:text-white">
                  Net Check Total
                </span>
                <span className="text-xl font-bold text-sky-600 dark:text-sky-400 font-mono">
                  {formatMoney(netTotal, currencySymbol)}
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {guestPickerOpen && <Modal label={`Choose a guest in Room ${roomNumber.trim()}`} onClose={() => setGuestPickerOpen(false)}>
        <div className="surface pms-guest-picker">
          <h2>Choose a guest in Room {roomNumber.trim()}</h2>
          <p>{pmsGuests.length} {pmsGuests.length === 1 ? 'guest found' : 'guests found'}. Select the person this bill is for. Each guest has their own departure date.</p>
          <fieldset><legend className="sr-only">In-house guests</legend>
            {pmsGuests.map((guest, index) => <label key={`${guest.propertyCode}-${guest.confirmationNumber || index}-${index}`} className={`pms-guest-option ${selectedPmsGuest === index ? 'is-selected' : ''}`}>
              <input type="radio" name="pms-guest" value={index} checked={selectedPmsGuest === index} onChange={() => setSelectedPmsGuest(index)} />
              <span><strong>{guest.fullName}</strong><span className="pms-guest-meta">{guest.guestType === 'main' ? 'Main guest' : 'Sharing guest'} · {guest.propertyCode} · Room {guest.roomNumber}</span>
                <span className="pms-guest-meta">Nationality: {guest.nationality || 'Not provided'} · Departure: {guest.checkoutDate ? displayDate(guest.checkoutDate) : 'Not provided'}</span>
                {guest.confirmationNumber && <span className="pms-guest-meta">Booking: {guest.confirmationNumber}</span>}
              </span>
            </label>)}
          </fieldset>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setGuestPickerOpen(false)}>Cancel</button><button type="button" className="primary-button" disabled={selectedPmsGuest === null} onClick={applyPmsGuest}>Use selected guest</button></div>
        </div>
      </Modal>}
      {discardOpen && <Modal label="Discard bill draft?" onClose={() => setDiscardOpen(false)}><div className="surface guard-dialog"><h2>Discard this draft?</h2><p>The guest details and selected activities will be removed from this tab.</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDiscardOpen(false)}>Keep draft</button><button className="danger-button" onClick={discardDraft}>Discard draft</button></div></div></Modal>}
      {/* Confirmation Modal */}
      {showConfirmModal && (
        <Modal label="Review bill" onClose={() => { if (!saving) { setShowConfirmModal(false); setErrorMsg(null); } } } busy={saving} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Save Bill #{checkNumber}?
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Posting check #{checkNumber} for <strong>{guestName}</strong> (Room {roomNumber}).
              Total net charge: <strong>{formatMoney(netTotal, currencySymbol)}</strong>.
            </p>

            <ul className="review-lines">{billLines.map((line, index) => <li key={index}><span>{line.quantity} × {line.itemName}{line.discountPercent > 0 ? ` · ${line.discountPercent}% discount` : ''}</span><strong>{formatMoney(line.lineTotal, currencySymbol)}</strong></li>)}</ul>
            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Items:</span>
                <span className="font-semibold">{billLines.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Business Date:</span>
                <span className="font-semibold">{displayDate(businessDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Net Amount:</span>
                <span className="font-bold text-sky-500 font-mono">{formatMoney(netTotal, currencySymbol)}</span>
              </div>
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || monthLock.locked !== false}
                onClick={handleSaveBill}
                className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold shadow-md shadow-sky-500/20 transition flex items-center justify-center space-x-1.5"
              >
                {saving ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm & Save</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
