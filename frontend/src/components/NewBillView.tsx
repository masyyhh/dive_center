import React, { useState, useEffect } from 'react';
import { useProperty } from '../context/PropertyContext';
import { apiFetch } from '../services/api';
import { Item, Category, StaffMember, BillItem } from '../types';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Info,
  DollarSign,
  UserCheck,
  ChevronRight,
  Receipt,
} from 'lucide-react';

interface NewBillViewProps {
  onBillSaved: () => void;
}

export const NewBillView: React.FC<NewBillViewProps> = ({ onBillSaved }) => {
  const { activeProperty } = useProperty();

  // Catalogue state
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Bill state
  const [checkNumber, setCheckNumber] = useState<number>(1001);
  const [businessDate, setBusinessDate] = useState<string>(
    new Date().toISOString().substring(0, 10)
  );
  const [roomNumber, setRoomNumber] = useState<string>('');
  const [guestName, setGuestName] = useState<string>('');
  const [departureDate, setDepartureDate] = useState<string>('');
  const [nationality, setNationality] = useState<string>('Other');
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [tipStaffIds, setTipStaffIds] = useState<string[]>([]);
  const [billLines, setBillLines] = useState<BillItem[]>([]);
  const [notes, setNotes] = useState<string>('');

  // Auto-fill suggestion state
  const [roomSuggestion, setRoomSuggestion] = useState<{
    guestName: string;
    roomNumber: string;
    departureDate?: string | null;
    nationality: string;
  } | null>(null);

  // Status & modal state
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  // Load items, categories, next check number, and staff members
  useEffect(() => {
    if (!activeProperty) return;

    const loadData = async () => {
      try {
        const [itemsData, nextCheckData, staffData] = await Promise.all([
          apiFetch<{ categories: Category[]; items: Item[] }>(
            `/items?propertyId=${activeProperty.id}`
          ),
          apiFetch<{ nextCheckNumber: number }>(
            `/bills/next-check?propertyId=${activeProperty.id}`
          ),
          apiFetch<{ staff: StaffMember[] }>(
            `/staff?propertyId=${activeProperty.id}`
          ),
        ]);

        setCategories(itemsData.categories);
        setItems(itemsData.items);
        setCheckNumber(nextCheckData.nextCheckNumber);
        setStaffList(staffData.staff);
      } catch (err) {
        console.error('Failed to load bill setup data:', err);
      }
    };

    loadData();
  }, [activeProperty]);

  // Room lookup auto-fill debounce (PDF Page 4)
  useEffect(() => {
    if (!roomNumber || roomNumber.trim().length < 2 || !activeProperty) {
      setRoomSuggestion(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{
          found: boolean;
          guest?: {
            guestName: string;
            roomNumber: string;
            departureDate?: string | null;
            nationality: string;
          };
        }>(`/bills/room-lookup?propertyId=${activeProperty.id}&roomNumber=${encodeURIComponent(roomNumber.trim())}`);

        if (res.found && res.guest) {
          // If guest name is not yet filled or differs, offer suggestion
          if (!guestName || guestName !== res.guest.guestName) {
            setRoomSuggestion(res.guest);
          }
        } else {
          setRoomSuggestion(null);
        }
      } catch (err) {
        console.error('Room lookup failed:', err);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [roomNumber, activeProperty]);

  const applyRoomSuggestion = () => {
    if (!roomSuggestion) return;
    setGuestName(roomSuggestion.guestName);
    if (roomSuggestion.departureDate) setDepartureDate(roomSuggestion.departureDate);
    if (roomSuggestion.nationality) setNationality(roomSuggestion.nationality);
    setRoomSuggestion(null);
  };

  // Add item from catalogue to bill
  const handleAddItem = (item: Item) => {
    // Parse personal roles and amounts
    let personalRoles: string[] = [];
    if (item.personalRoles) {
      personalRoles = item.personalRoles.split(',').map((r) => r.trim().toLowerCase());
    }

    let personalCommissionsJson = item.personalRatesJson || null;

    // Check if line item already exists
    const existingIndex = billLines.findIndex((l) => l.itemId === item.id);
    if (existingIndex >= 0) {
      const updated = [...billLines];
      const line = updated[existingIndex];
      const newQty = line.quantity + 1;
      const lineGross = newQty * line.unitPrice;
      const discount = (lineGross * line.discountPercent) / 100;
      line.quantity = newQty;
      line.lineTotal = lineGross - discount;
      setBillLines(updated);
      return;
    }

    const newLine: BillItem = {
      itemId: item.id,
      itemName: item.name,
      categoryName: item.category?.name || 'General',
      quantity: 1,
      unitPrice: item.price,
      discountPercent: 0,
      lineTotal: item.price,
      personalCommissionsJson,
      sellerStaffId: null,
      guideStaffId: null,
      instructorStaffId: null,
      photoStaffId: null,
      videoStaffId: null,
    };

    setBillLines([...billLines, newLine]);
  };

  const updateQuantity = (index: number, delta: number) => {
    const updated = [...billLines];
    const line = updated[index];
    const newQty = Math.max(1, line.quantity + delta);
    const lineGross = newQty * line.unitPrice;
    const discount = (lineGross * line.discountPercent) / 100;
    line.quantity = newQty;
    line.lineTotal = lineGross - discount;
    setBillLines(updated);
  };

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

  const removeLine = (index: number) => {
    const updated = billLines.filter((_, i) => i !== index);
    setBillLines(updated);
  };

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
      searchQuery === '' ||
      it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      it.code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  const handleSaveBill = async () => {
    if (!activeProperty) return;
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
      onBillSaved();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save bill.');
    } finally {
      setSaving(false);
    }
  };

  const countries = [
    'Other',
    'Australia',
    'China',
    'France',
    'Germany',
    'India',
    'Italy',
    'Japan',
    'Maldives',
    'Russia',
    'Singapore',
    'Switzerland',
    'United Kingdom',
    'United States',
  ];

  return (
    <div className="space-y-6">
      {/* Top check number stepper bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Receipt className="w-5 h-5 text-sky-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Micros Check Number:
            </span>
          </div>

          {/* Stepper (+ / -) to match Micros check per PDF Page 3 */}
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setCheckNumber((prev) => Math.max(1, prev - 1))}
              className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              title="Decrement check number"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number"
              value={checkNumber}
              onChange={(e) => setCheckNumber(parseInt(e.target.value, 10) || 1)}
              className="w-20 text-center font-mono font-bold text-sm bg-transparent text-slate-900 dark:text-white focus:outline-none"
            />
            <button
              onClick={() => setCheckNumber((prev) => prev + 1)}
              className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              title="Increment check number"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Business Date Picker */}
        <div className="flex items-center space-x-3 text-xs">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Business Date:</span>
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Two-half layout: Item Catalogue (Left) & Bill Draft (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Half: Item Catalogue */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Item Catalogue
              </h2>
              <span className="text-xs text-slate-400">
                {filteredItems.length} items available
              </span>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search dive, course, or item..."
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Category Chips */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedCategory('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
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
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    selectedCategory === c.id
                      ? 'bg-sky-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {/* Item List */}
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {filteredItems.map((item) => {
                const hasPersonalRoles = Boolean(item.personalRoles && item.personalRoles.trim().length > 0);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleAddItem(item)}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 hover:border-sky-400 dark:hover:border-sky-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-sky-50/40 dark:hover:bg-sky-950/30 transition cursor-pointer flex items-center justify-between group"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-[10px] text-slate-400 font-semibold">
                          {item.code}
                        </span>
                        {hasPersonalRoles && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                            Commission: {item.personalRoles}
                          </span>
                        )}
                        {item.poolType !== 'NONE' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                            {item.poolType === 'COURSE_POOL' ? 'Course Pool' : 'Dive Pool'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white mt-0.5 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition">
                        {item.name}
                      </div>
                    </div>

                    <div className="text-right flex items-center space-x-2">
                      <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                        {currencySymbol}{item.price.toFixed(2)}
                      </span>
                      <div className="w-6 h-6 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Half: Bill Being Built */}
        <div className="lg:col-span-7 space-y-4">
          {/* Guest Details Section */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <UserCheck className="w-4 h-4 text-sky-500" />
              <span>Guest Details</span>
            </h3>

            {/* Smart Room Auto-fill Banner (PDF Page 4) */}
            {roomSuggestion && (
              <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-xs flex items-center justify-between">
                <div className="flex items-center space-x-2 text-sky-800 dark:text-sky-300">
                  <Sparkles className="w-4 h-4 text-sky-500 flex-shrink-0" />
                  <span>
                    Found today's guest in Room <strong>{roomSuggestion.roomNumber}</strong>: <strong>{roomSuggestion.guestName}</strong> ({roomSuggestion.nationality})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={applyRoomSuggestion}
                  className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] transition shadow-xs"
                >
                  Auto-fill Guest
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Room Number *
                </label>
                <input
                  type="text"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="e.g. 304"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Guest Name *
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Julian Weber"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Departure Date
                </label>
                <input
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                  Nationality
                </label>
                <select
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
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
                Line Items ({billLines.length})
              </h3>
              <span className="text-xs text-slate-400">
                Click items on the left to add
              </span>
            </div>

            {billLines.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                No items added yet. Click an item in the catalogue on the left to add to check #{checkNumber}.
              </div>
            ) : (
              <div className="space-y-3">
                {billLines.map((line, idx) => {
                  let personalRoles: string[] = [];
                  if (line.personalCommissionsJson) {
                    try {
                      personalRoles = Object.keys(JSON.parse(line.personalCommissionsJson));
                    } catch {}
                  }

                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {line.itemName}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-2">
                            ({line.categoryName})
                          </span>
                        </div>
                        <button
                          onClick={() => removeLine(idx)}
                          className="p-1 text-slate-400 hover:text-rose-500 transition"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
                        {/* Quantity Stepper */}
                        <div className="flex items-center space-x-1">
                          <span className="text-slate-400 text-[11px]">Qty:</span>
                          <button
                            type="button"
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
                            onClick={() => updateQuantity(idx, 1)}
                            className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold"
                          >
                            +
                          </button>
                        </div>

                        {/* Price */}
                        <div>
                          <span className="text-slate-400 text-[11px]">Price: </span>
                          <span className="font-mono font-semibold">
                            {currencySymbol}{line.unitPrice.toFixed(2)}
                          </span>
                        </div>

                        {/* Discount (%) */}
                        <div className="flex items-center space-x-1">
                          <span className="text-slate-400 text-[11px]">Disc%:</span>
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
                        <div className="text-right font-extrabold text-slate-900 dark:text-white font-mono">
                          {currencySymbol}{line.lineTotal.toFixed(2)}
                        </div>
                      </div>

                      {/* Personal Commission on a Line (PDF Page 3 & 4) */}
                      {personalRoles.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 bg-purple-500/5 -mx-3 -mb-3 p-3 rounded-b-xl space-y-1.5">
                          <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center space-x-1">
                            <Info className="w-3 h-3" />
                            <span>Credit Staff for Line Commission:</span>
                          </span>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {personalRoles.includes('seller') && (
                              <div>
                                <label className="block text-[10px] font-medium text-slate-500">
                                  Seller:
                                </label>
                                <select
                                  value={line.sellerStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'seller', e.target.value)}
                                  className="w-full text-[11px] px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
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
                                <label className="block text-[10px] font-medium text-slate-500">
                                  Guide / Divemaster:
                                </label>
                                <select
                                  value={line.guideStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'guide', e.target.value)}
                                  className="w-full text-[11px] px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
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
                                <label className="block text-[10px] font-medium text-slate-500">
                                  Instructor:
                                </label>
                                <select
                                  value={line.instructorStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'instructor', e.target.value)}
                                  className="w-full text-[11px] px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
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
                                <label className="block text-[10px] font-medium text-slate-500">
                                  Photographer:
                                </label>
                                <select
                                  value={line.photoStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'photo', e.target.value)}
                                  className="w-full text-[11px] px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
                                >
                                  <option value="">Select photographer...</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.roleTitle})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {personalRoles.includes('video') && (
                              <div>
                                <label className="block text-[10px] font-medium text-slate-500">
                                  Videographer:
                                </label>
                                <select
                                  value={line.videoStaffId || ''}
                                  onChange={(e) => updateStaffAssignment(idx, 'video', e.target.value)}
                                  className="w-full text-[11px] px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 text-slate-900 dark:text-white focus:outline-none"
                                >
                                  <option value="">Select videographer...</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.roleTitle})
                                    </option>
                                  ))}
                                </select>
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
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                    Guest Tip ({currencySymbol})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={tipAmount || ''}
                    onChange={(e) => setTipAmount(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                {tipAmount > 0 && (
                  <div>
                    <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Staff Sharing Tip (split equally)
                    </label>
                    <select
                      multiple
                      value={tipStaffIds}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                        setTipStaffIds(selected);
                      }}
                      className="w-full px-2 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none text-xs"
                      size={2}
                    >
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Running Totals Breakdown Flow (PDF Page 3) */}
            {/* Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net */}
            <div className="bg-slate-50 dark:bg-slate-800/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>Gross Total</span>
                <span className="font-mono font-medium">{currencySymbol}{grossAmount.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>- Total Discount</span>
                  <span className="font-mono font-medium">-{currencySymbol}{discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>+ Service Charge ({scRate}%)</span>
                <span className="font-mono font-medium">{currencySymbol}{serviceChargeAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>+ Tax / TGST ({taxRate}%)</span>
                <span className="font-mono font-medium">{currencySymbol}{taxAmount.toFixed(2)}</span>
              </div>
              {tipAmount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>+ Guest Tip</span>
                  <span className="font-mono font-medium">+{currencySymbol}{tipAmount.toFixed(2)}</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-sm">
                <span className="font-extrabold text-slate-900 dark:text-white">
                  Net Check Total
                </span>
                <span className="text-xl font-black text-sky-600 dark:text-sky-400 font-mono">
                  {currencySymbol}{netTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Save Bill Button */}
            <button
              type="button"
              disabled={billLines.length === 0 || saving}
              onClick={() => setShowConfirmModal(true)}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 text-white font-bold text-sm shadow-md shadow-sky-500/20 hover:from-sky-600 hover:to-teal-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              <span>Confirm & Save Bill #{checkNumber}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Save Bill #{checkNumber}?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Posting check #{checkNumber} for <strong>{guestName}</strong> (Room {roomNumber}).
              Total net charge: <strong>{currencySymbol}{netTotal.toFixed(2)}</strong>.
            </p>

            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Items:</span>
                <span className="font-semibold">{billLines.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Business Date:</span>
                <span className="font-semibold">{businessDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Net Amount:</span>
                <span className="font-bold text-sky-500 font-mono">{currencySymbol}{netTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveBill}
                className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold shadow-md shadow-sky-500/20 transition flex items-center justify-center space-x-1.5"
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
        </div>
      )}
    </div>
  );
};
