import { usesCompactBilling } from '../../utils/propertyPresentation';
import { photoIds } from '../../utils/photoCredits';
import { instructorIds } from '../../utils/instructorCredits';
import { billToEditDraft } from '../../utils/billEditing';
import { isRoomNumber, isPositiveInt, roomNumberHelp } from '../../utils/inputValidation';
import { applyCheckoutDiscount } from '../../utils/checkoutDiscount';
import { addActivityWithPhoto, addPackageWithPhoto, normalizeAutomaticPhotos, removeActivityWithPhoto, updateLinkedQuantity } from '../../utils/automaticPhotos';
import { guestBillFields } from '../../utils/pmsGuests';
import { useMonthLock } from '../../hooks/useMonthLock';
import { useAuth } from '../../context/AuthContext';
import { useUnsavedChanges } from '../../context/NavigationContext';
import { BillDraft, billDraftKey, loadBillDraft } from '../../utils/billDraft';
import { businessToday, isBusinessDate } from '../../utils/dates';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { apiFetch, ApiError } from '../../services/api';
import { Item, Category, StaffMember, Bill, BillItem, PmsGuest, DivePackage } from '../../types';

export interface NewBillViewProps {
  onBillSaved: (checkNumber: number) => void;
  onSetup: () => void;
  editingBill?: Bill;
  onCancel?: () => void;
}

export function useBillController({ onBillSaved, onSetup, editingBill, onCancel }: NewBillViewProps) {
  const { activeProperty } = useProperty();
  const { user } = useAuth();
  const compactBilling = usesCompactBilling(activeProperty);
  const canManage = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const draftKey = billDraftKey(user?.id || '', activeProperty?.id || '') + (editingBill ? `:edit:${editingBill.id}` : '');
  const restoredDraft = useMemo(() => { const saved = loadBillDraft(draftKey); return editingBill ? saved?.expectedUpdatedAt === editingBill.updatedAt ? saved : billToEditDraft(editingBill) : saved; }, [draftKey, editingBill?.updatedAt]);
  const [editReason, setEditReason] = useState(restoredDraft?.editReason || '');
  const [partialDiscount, setPartialDiscount] = useState<{ lineId: string; quantity: string; percent: string } | null>(null);
  const [restored, setRestored] = useState(Boolean(restoredDraft));
  const [draftError, setDraftError] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [attemptedReview, setAttemptedReview] = useState(false);
  const [checkEdited, setCheckEdited] = useState(restoredDraft?.checkEdited || false);
  const [nextCheck, setNextCheck] = useState(1001);

  // Catalogue & Packages state
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [packages, setPackages] = useState<DivePackage[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffNotice, setStaffNotice] = useState('');
  const [loadedStaffKey, setLoadedStaffKey] = useState('');
  const [staffReload, setStaffReload] = useState(0);

  const photoRates = useMemo(() => ({
    price: activeProperty?.autoPhotoPrice,
    commission: activeProperty?.autoPhotoCommission,
  }), [activeProperty?.autoPhotoPrice, activeProperty?.autoPhotoCommission]);

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
  const [checkoutDiscountValue, setCheckoutDiscountValue] = useState(restoredDraft?.checkoutDiscountPercent ?? '');
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
  const [saveNotice, setSaveNotice] = useState('');
  const saveInFlight = useRef(false);

  const dirty = checkoutDiscountValue !== '' || billLines.length > 0 || Boolean(roomNumber || guestName || departureDate || notes) || nationality !== 'Other' || tipAmount > 0 || tipStaffIds.length > 0 || checkEdited || businessDate !== businessToday();
  const releaseGuard = useUnsavedChanges(dirty, saving ? 'Your bill is being saved. Please wait for confirmation.' : draftError ? 'Your bill has unsaved changes. Draft storage is unavailable; leaving will lose this work.' : 'This bill has not been submitted. Its draft is kept in this browser tab for this account and property.', saving);
  useEffect(() => {
    try {
      if (dirty) {
        const draft: BillDraft = { version: 1, ...(editingBill ? { expectedUpdatedAt: editingBill.updatedAt, editReason } : {}), checkNumber, businessDate, roomNumber, guestName, departureDate, nationality, tipAmount, tipStaffIds, billLines, notes, checkEdited, checkoutDiscountPercent: checkoutDiscountValue };
        sessionStorage.setItem(draftKey, JSON.stringify(draft));
      } else { sessionStorage.removeItem(draftKey); setRestored(false); }
      setDraftError(false);
    } catch { setDraftError(true); }
  }, [draftKey, dirty, checkNumber, businessDate, roomNumber, guestName, departureDate, nationality, tipAmount, tipStaffIds, billLines, notes, checkEdited, checkoutDiscountValue, editReason]);
  const discardDraft = () => {
    if (editingBill) { try { sessionStorage.removeItem(draftKey); } catch {} releaseGuard(); onCancel?.(); return; }
    setBillLines([]); setRoomNumber(''); setGuestName(''); setDepartureDate(''); setNationality('Other');
    setCheckoutDiscountValue(''); setTipAmount(0); setTipStaffIds([]); setNotes(''); setBusinessDate(businessToday()); setCheckNumber(nextCheck);
    setCheckEdited(false); setRestored(false); setAttemptedReview(false); setPartialDiscount(null); setErrorMsg(null); setPmsGuests([]); setPmsMessage(''); setPmsError(''); setGuestPickerOpen(false); cancelPmsLookup(); setDiscardOpen(false);
  };
  // Load the catalogue and next check number
  useEffect(() => {
    let cancelled = false;
    setItems([]); setCategories([]); setPackages([]);
    if (!activeProperty) { setSetupLoading(false); return; }

    const loadData = async () => {
      setSetupLoading(true);
      setErrorMsg(null);
      try {
        const [itemsData, nextCheckData, packagesData] = await Promise.all([
          apiFetch<{ categories: Category[]; items: Item[] }>(
            `/items?propertyId=${activeProperty.id}`
          ),
          apiFetch<{ nextCheckNumber: number }>(
            `/bills/next-check?propertyId=${activeProperty.id}`
          ),
          apiFetch<{ packages: DivePackage[] }>(
            `/packages?propertyId=${activeProperty.id}`
          ).catch(() => ({ packages: [] })),
        ]);

        if (cancelled) return;
        setCategories(itemsData.categories);
        setItems(itemsData.items);
        setPackages(packagesData.packages || []);
        setBillLines(lines => normalizeAutomaticPhotos(lines, itemsData.items, undefined, photoRates));
        setNextCheck(nextCheckData.nextCheckNumber);
        if (!restoredDraft) setCheckNumber(nextCheckData.nextCheckNumber);
      } catch (err) {
        if (!cancelled) setErrorMsg('Unable to load the catalogue. Please reload this page to try again.');
      } finally {
        if (!cancelled) setSetupLoading(false);
      }
    };

    loadData();
    return () => { cancelled = true; };
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
          const selectedInstructors = instructorIds(line).filter(id => ids.has(id));
          const selectedPhotoStaff = photoIds(line).filter(id => ids.has(id));
          const updated = { ...line, photoStaffIds: selectedPhotoStaff, photoStaffId: selectedPhotoStaff[0] || null, instructorStaffIds: selectedInstructors, instructorStaffId: selectedInstructors[0] || null };
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
    if (!activeProperty || !isRoomNumber(roomNumber) || saving || pmsBusy) return;
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

  // Included activities add a linked Photo line at property autoPhotoPrice per service unit.
  const handleAddItem = (item: Item) => {
    try { setBillLines(addActivityWithPhoto(billLines, item, items, undefined, photoRates)); setErrorMsg(null); }
    catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Could not add the activity.'); }
  };

  const handleAddPackage = (pkg: DivePackage) => {
    try { setBillLines(addPackageWithPhoto(billLines, pkg, items, undefined, photoRates)); setErrorMsg(null); }
    catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Could not add the package.'); }
  };

  const updateQuantity = (index: number, delta: number) => setBillLines(lines => updateLinkedQuantity(lines, index, delta, items, photoRates));

  const updateDiscount = (index: number, discountPercent: number) => {
    const updated = [...billLines];
    const line = { ...updated[index] };
    updated[index] = line;
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
    if (role === 'instructor') { line.instructorStaffId = staffId || null; line.instructorStaffIds = staffId ? [staffId] : []; }
    if (role === 'photo') { line.photoStaffId = staffId || null; line.photoStaffIds = staffId ? [staffId] : []; }
    if (role === 'video') line.videoStaffId = staffId || null;
    setBillLines(updated);
  };

  const removeLine = (index: number) => setBillLines(lines => removeActivityWithPhoto(lines, index));

  // Calculations per PDF Page 3 & 4:
  // Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net
  const originalBase = editingBill ? editingBill.grossAmount - editingBill.discountAmount : 0;
  const scRate = editingBill?.serviceChargeRateSnapshot ?? (editingBill && originalBase > 0 ? editingBill.serviceChargeAmount / originalBase * 100 : activeProperty?.serviceChargeRate ?? 10);
  const taxRate = editingBill?.taxRateSnapshot ?? (editingBill && originalBase + editingBill.serviceChargeAmount > 0 ? editingBill.taxAmount / (originalBase + editingBill.serviceChargeAmount) * 100 : activeProperty?.taxRate ?? 16);

  const checkoutDiscountPercent = checkoutDiscountValue === '' ? 0 : Number(checkoutDiscountValue);
  const checkoutPreview = useMemo(() => {
    try { return { ...applyCheckoutDiscount(billLines, checkoutDiscountPercent), error: '' }; }
    catch (error) { return { lines: billLines, amount: 0, subtotal: 0, error: error instanceof Error ? error.message : 'Enter a valid checkout discount.' }; }
  }, [billLines, checkoutDiscountValue]);
  const grossAmount = billLines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
  const lineDiscountAmount = billLines.reduce(
    (acc, l) => acc + (l.unitPrice * l.quantity * l.discountPercent) / 100,
    0
  );
  const discountAmount = lineDiscountAmount + checkoutPreview.amount;
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

  const filteredPackages = packages.filter((pkg) => {
    if (!pkg.isActive) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      pkg.name.toLowerCase().includes(q) ||
      pkg.code.toLowerCase().includes(q) ||
      (pkg.description || '').toLowerCase().includes(q)
    );
  });

  const handleSaveBill = async () => {
    if (saving || saveInFlight.current) return;
    if (!activeProperty || monthLock.locked !== false) return;
    if (checkoutPreview.error) { setErrorMsg(checkoutPreview.error); return; }
    if (!staffReady) { setErrorMsg('Wait for staff availability to load before saving.'); return; }
    setErrorMsg(null);

    if (!isRoomNumber(roomNumber)) {
      setErrorMsg(roomNumberHelp);
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

    saveInFlight.current = true;
    try {
      setSaving(true);
      await apiFetch(editingBill ? `/bills/${editingBill.id}` : '/bills', {
        method: editingBill ? 'PUT' : 'POST',
        body: JSON.stringify({
          propertyId: activeProperty.id,
          ...(editingBill ? { expectedUpdatedAt: editingBill.updatedAt, editReason: editReason.trim() } : {}),
          checkNumber: Number(checkNumber),
          businessDate,
          guestName: guestName.trim(),
          roomNumber: roomNumber.trim(),
          departureDate: departureDate || null,
          nationality,
          tipAmount: Number(tipAmount) || 0,
          tipStaffIds,
          items: billLines,
          checkoutDiscountPercent,
          notes,
        }),
      });

      setShowConfirmModal(false);
      try { sessionStorage.removeItem(draftKey); } catch { /* Form remains saved on the server. */ }
      releaseGuard();
      if (compactBilling && !editingBill) {
        discardDraft();
        setBusinessDate(businessDate);
        setCheckNumber(checkNumber < 2147483647 ? checkNumber + 1 : 0);
        setSaveNotice(`Bill #${checkNumber} saved successfully. Ready for the next bill.`);
      }
      onBillSaved(checkNumber);
      if (compactBilling && !editingBill) {
        // A failed sequence lookup must never report the already-posted bill as failed.
        try {
          const next = await apiFetch<{ nextCheckNumber: number }>(`/bills/next-check?propertyId=${activeProperty.id}`);
          const number = Math.max(next.nextCheckNumber, checkNumber + 1);
          if (!isPositiveInt(number)) throw new Error('No valid next check number.');
          setNextCheck(number); setCheckNumber(number);
        } catch {
          setCheckNumber(0);
          setSaveNotice(`Bill #${checkNumber} saved successfully. Enter the next check number manually.`);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save bill.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const reviewBill = () => {
    if (saving || saveInFlight.current) return;
    setSaveNotice('');
    if (partialDiscount) { setErrorMsg('Apply or cancel the selected-unit discount before reviewing the bill.'); return; }
    if (editingBill && editReason.trim().length < 5) { setErrorMsg('Enter a reason for editing this posted bill (at least 5 characters).'); document.getElementById('bill-edit-reason')?.focus(); return; }
    setAttemptedReview(true); setErrorMsg(null);
    if (!isPositiveInt(checkNumber)) { setErrorMsg('Enter a whole check number between 1 and 2147483647.'); document.getElementById('bill-check-number')?.focus(); return; }
    if (checkoutPreview.error) { setErrorMsg(checkoutPreview.error); document.getElementById('checkout-discount')?.focus(); return; }
    if (!isBusinessDate(businessDate)) { document.getElementById('bill-business-date')?.focus(); return; }
    if (!isRoomNumber(roomNumber) || !guestName.trim()) {
      document.getElementById(!isRoomNumber(roomNumber) ? 'bill-room' : 'bill-guest')?.focus();
      return;
    }
    if (billLines.length > 200) { setErrorMsg('A bill can contain up to 200 lines, including automatic Photos. Remove an activity before saving.'); return; }
    if (!billLines.length) { document.getElementById('bill-activities')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (monthLock.locked !== false) { setErrorMsg(monthLock.locked ? 'Choose a business date in an open month before saving.' : 'Please wait for payroll status to load, or retry if it failed.'); return; }
    if (!staffReady) { setErrorMsg('Wait for staff availability to load before reviewing.'); return; }
    if (compactBilling) return handleSaveBill();
    setShowConfirmModal(true);
  };
  return {
    activeProperty,
    applyPmsGuest,
    attemptedReview,
    billLines,
    businessDate,
    canManage,
    cancelPmsLookup,
    categories,
    checkNumber,
    checkoutDiscountPercent,
    checkoutDiscountValue,
    checkoutPreview,
    compactBilling,
    currencySymbol,
    departureDate,
    dirty,
    discardDraft,
    discardOpen,
    draftError,
    editReason,
    editingBill,
    errorMsg,
    filteredItems,
    filteredPackages,
    grossAmount,
    guestName,
    guestPickerOpen,
    handleAddItem,
    handleAddPackage,
    handleSaveBill,
    items,
    lineDiscountAmount,
    lookupGuests,
    monthLock,
    nationality,
    netBeforeCharges,
    netTotal,
    notes,
    onSetup,
    packages,
    partialDiscount,
    photoRates,
    pmsBusy,
    pmsError,
    pmsGuests,
    pmsMessage,
    removeLine,
    restored,
    reviewBill,
    roomNumber,
    saving,
    saveNotice,
    setSaveNotice,
    scRate,
    searchQuery,
    selectedCategory,
    selectedPmsGuest,
    serviceChargeAmount,
    setBillLines,
    setBusinessDate,
    setCheckEdited,
    setCheckNumber,
    setCheckoutDiscountValue,
    setDepartureDate,
    setDiscardOpen,
    setEditReason,
    setErrorMsg,
    setGuestName,
    setGuestPickerOpen,
    setNationality,
    setNotes,
    setPartialDiscount,
    setRoomNumber,
    setSearchQuery,
    setSelectedCategory,
    setSelectedPmsGuest,
    setShowConfirmModal,
    setStaffReload,
    setTipAmount,
    setTipStaffIds,
    setupLoading,
    showConfirmModal,
    staffList,
    staffLoading,
    staffNotice,
    staffReady,
    taxAmount,
    taxRate,
    tipAmount,
    tipStaffIds,
    updateDiscount,
    updateQuantity,
    updateStaffAssignment,
  };
}

export type BillModel = ReturnType<typeof useBillController>;
