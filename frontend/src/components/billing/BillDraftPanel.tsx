import { useState, type ReactNode } from 'react';
import { GuestDetails } from './GuestDetails';
import { BillTotals } from './BillTotals';
import { photoIds } from '../../utils/photoCredits';
import { instructorIds } from '../../utils/instructorCredits';
import { InstructorPicker } from '../InstructorPicker';
import { discountSelectedQuantity } from '../../utils/automaticPhotos';
import { adjustBillLine, type PriceAdjustment } from '../../utils/billPricing';
import { usesStoreAttendantPool } from '../../utils/storeAttendantPool';
import { formatMoney, formatUnitPrice } from '../../utils/format';

import { Trash2, Info } from 'lucide-react';
import { TipControl, DiscountControl } from './CheckoutFields';
import type { BillModel } from './useBillController';

export function BillDraftPanel({ model }: { model: BillModel }) {
  const {
    activeProperty, billLines, checkNumber, checkoutPreview,
    compactBilling, currencySymbol, notes, partialDiscount,
    removeLine, saving, setBillLines, setErrorMsg,
    setNotes, setPartialDiscount, setTipStaffIds, staffList,
    staffReady, tipAmount, tipStaffIds, updateDiscount,
    updateQuantity, updateStaffAssignment,
  } = model;
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [adjustmentKind, setAdjustmentKind] = useState<PriceAdjustment>('discountPercent');
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const keyFor = (line: typeof billLines[number], index: number) => line.clientLineId || String(index);
  const selected = billLines.filter((line, index) => selectedKeys.includes(keyFor(line, index)));
  const selectedPhoto = selected.some(line => line.autoPhotoFor);
  const applyAdjustment = (keys: string[], kind: PriceAdjustment, raw: string) => {
    try {
      if (!raw.trim()) throw new Error('Enter a price or discount before applying.');
      const updated = billLines.map((line, index) => keys.includes(keyFor(line, index)) ? adjustBillLine(line, kind, Number(raw)) : line);
      setBillLines(updated); setErrorMsg(null);
    } catch (error) { setErrorMsg((error as Error).message); }
  };
  const StaffPanel = 'div';
  return (
    <div className="bill-draft-panel xl:col-span-7 space-y-4" id="bill-draft">

      {!compactBilling && <GuestDetails model={model} />}
      {/* Bill Lines Table */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 bill-draft-card">
        {!compactBilling && <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            3. Review bill lines ({billLines.length})
          </h3>
          {!compactBilling && <span className="text-sm text-slate-400">Prices and assignments for this check</span>}
        </div>}

        {billLines.length === 0 && !compactBilling ? (
          <div className="py-8 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            {compactBilling ? `Choose activities to add to check #${checkNumber}.` : `No items added yet. Click an item in the catalogue on the left to add to check #${checkNumber}.`}
          </div>
        ) : (
          <LineList compact={compactBilling}>
            {compactBilling && !billLines.length && <tr><td colSpan={7} className="siyam-empty-lines">Add an activity to start this bill.</td></tr>}
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
                } catch { }
              }

              const lineKey = line.clientLineId || String(idx);
              const storeAttendantPool = line.sourceLineId ? line.storeAttendantRateSnapshot === 5 : usesStoreAttendantPool(activeProperty, line.categoryName);
              const storePoolPreview = Math.round((checkoutPreview.lines[idx]?.lineTotal ?? line.lineTotal) * 5) / 100;
              const partialDiscountControls = (partialDiscount && partialDiscount.lineId === line.clientLineId && <div className="surface p-3 space-y-2" role="group" aria-label={`Discount selected units of ${line.itemName}`}><div className="flex flex-wrap items-end gap-3"><label>Units to discount<input type="number" min={1} max={line.quantity} step={1} value={partialDiscount.quantity} onChange={event => setPartialDiscount({ ...partialDiscount, quantity: event.target.value })} /></label><label>Discount (%)<input type="number" min={0} max={100} step="0.01" value={partialDiscount.percent} onChange={event => setPartialDiscount({ ...partialDiscount, percent: event.target.value })} /></label><button type="button" className="secondary-button" disabled={saving} onClick={() => { try { if (partialDiscount.quantity === '' || partialDiscount.percent === '') throw new Error('Enter a quantity and discount percentage.'); setBillLines(discountSelectedQuantity(billLines, billLines.findIndex(value => value.clientLineId === partialDiscount.lineId), Number(partialDiscount.quantity), Number(partialDiscount.percent))); setPartialDiscount(null); setErrorMsg(null); } catch (error) { setErrorMsg((error as Error).message); } }}>Apply to selected units</button><button type="button" className="text-button" onClick={() => setPartialDiscount(null)}>Cancel</button></div><p className="text-xs text-slate-500">Discounted units and remaining units appear as separate bill lines. Personal commission reduces by the same discount percentage.</p></div>);
              const editor = (
                <div
                  key={line.clientLineId || idx}
                  className="bill-line p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2 text-sm"
                >
                  {!compactBilling && <div className="flex items-center justify-between gap-2">
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
                      className="line-remove-button p-1 text-slate-400 hover:text-rose-500 transition"
                      title={line.autoPhotoFor ? 'Remove the activity to remove its Photo line' : 'Remove item'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  }
                  {line.autoPhotoFor && <p className="text-xs text-slate-500">Automatically added with {billLines.find(parent => parent.clientLineId === line.autoPhotoFor)?.itemName}. Service charge and tax are added at checkout. Select one or more Photo staff below.</p>}
                  {!compactBilling && <div className="bill-line-controls grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
                    {/* Quantity Stepper */}
                    <div className="line-quantity flex items-center space-x-1">
                      <span className="text-slate-400 text-xs">Qty:</span>
                      <button
                        type="button"
                        disabled={Boolean(line.autoPhotoFor)}
                        aria-label={`Decrease quantity for ${line.itemName}`}
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
                        aria-label={`Increase quantity for ${line.itemName}`}
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
                        {formatUnitPrice(line.unitPrice, currencySymbol)}
                      </span>
                    </div>

                    {/* Discount (%) */}
                    <div className="flex items-center space-x-1">
                      <span className="text-slate-400 text-xs">{compactBilling ? 'Discount %:' : `Discount % · all ${line.quantity} units:`}</span>
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

                  }
                  {line.quantity > 1 && <button type="button" className="text-button" disabled={saving} onClick={() => setPartialDiscount({ lineId: line.clientLineId!, quantity: '1', percent: String(line.discountPercent) })}>Discount only some units</button>}
                  {partialDiscountControls}
                  {/* Personal Commission on a Line (PDF Page 3 & 4) */}
                  {personalRoles.length > 0 && (
                    <StaffPanel className={compactBilling ? "bill-line-staff" : "mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 bg-purple-500/5 -mx-3 -mb-3 p-3 rounded-b-xl space-y-1.5"}>
                      {compactBilling && <h4>Staff credits</h4>}
                      <div className="mt-2 space-y-2">
                      <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center space-x-1">
                        <Info className="w-3 h-3" />
                        <span>{compactBilling ? 'Commission staff' : 'Credit Staff for Line Commission:'}</span>
                      </span>
                      <p className="text-xs text-slate-500">Personal commission is reduced by {(checkoutPreview.lines[idx]?.discountPercent ?? line.discountPercent).toLocaleString('en-US', { maximumFractionDigits: 4 })}% including any checkout discount.</p>

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

                        {personalRoles.includes('instructor') && <InstructorPicker
                          staff={staffList} selectedIds={instructorIds(line)} disabled={!staffReady || saving}
                          unitRate={personalRates.instructor} quantity={line.quantity}
                          discountPercent={checkoutPreview.lines[idx]?.discountPercent ?? line.discountPercent}
                          currencySymbol={currencySymbol}
                          onChange={selected => setBillLines(lines => lines.map((value, index) => index === idx ? { ...value, instructorStaffIds: selected, instructorStaffId: selected[0] || null } : value))}
                        />}

                        {personalRoles.includes('photo') && <InstructorPicker role="photo"
                          staff={staffList} selectedIds={photoIds(line)} disabled={!staffReady || saving}
                          unitRate={personalRates.photo} quantity={line.quantity}
                          discountPercent={checkoutPreview.lines[idx]?.discountPercent ?? line.discountPercent}
                          currencySymbol={currencySymbol}
                          onChange={selected => setBillLines(lines => lines.map((value, index) => index === idx ? { ...value, photoStaffIds: selected, photoStaffId: selected[0] || null } : value))}
                        />}

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
                    </StaffPanel>
                  )}
                </div>
              );
              if (!compactBilling) return editor;
              return <tr key={lineKey} data-bill-line={lineKey} tabIndex={0} aria-selected={selectedKeys.includes(lineKey)} title="Click to select; Ctrl/⌘-click to select multiple services" className={selectedKeys.includes(lineKey) ? 'siyam-line-selected' : ''}
                  onClick={event => {
                    if (saving || (event.target as HTMLElement).closest?.('button,input,select,textarea,label,a')) return;
                    setSelectedKeys(keys => event.ctrlKey || event.metaKey ? keys.includes(lineKey) ? keys.filter(key => key !== lineKey) : [...keys, lineKey] : [lineKey]);
                  }}
                  onKeyDown={event => {
                    if (saving || event.target !== event.currentTarget) return;
                    if (event.key === 'Escape') { event.preventDefault(); setSelectedKeys([]); }
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedKeys(billLines.map(keyFor)); }
                    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setSelectedKeys(keys => event.ctrlKey || event.metaKey ? keys.includes(lineKey) ? keys.filter(key => key !== lineKey) : [...keys, lineKey] : [lineKey]); }
                  }}>

                  <td><div className="siyam-row-quantity"><button type="button" aria-label={`Decrease quantity for ${line.itemName}`} disabled={saving || Boolean(line.autoPhotoFor)} onClick={() => updateQuantity(idx, -1)}>−</button><span>{line.quantity}</span><button type="button" aria-label={`Increase quantity for ${line.itemName}`} disabled={saving || Boolean(line.autoPhotoFor)} onClick={() => updateQuantity(idx, 1)}>+</button></div></td>
                  <td className="siyam-description-cell"><strong>{line.itemName}</strong>{line.autoPhotoFor && <small>Linked Photo</small>}{line.quantity > 1 && <button type="button" className="text-button siyam-partial-discount" disabled={saving} onClick={() => setPartialDiscount({ lineId: line.clientLineId!, quantity: '1', percent: String(line.discountPercent) })}>Discount only some units</button>}{partialDiscountControls}</td>
                  <td className="siyam-money">{line.autoPhotoFor ? formatUnitPrice(line.unitPrice, currencySymbol) : <input className="siyam-price-input" aria-label={`Unit price for ${line.itemName}`} type="number" min="0" step="any" disabled={saving} value={line.unitPrice} onChange={event => applyAdjustment([lineKey], 'unitPrice', event.target.value)} />}</td>
                  <td className="siyam-discount-cell"><input aria-label={`Discount percentage for ${line.itemName}`} type="number" min="0" max="100" disabled={saving} value={line.discountPercent} onChange={event => updateDiscount(idx, Number(event.target.value) || 0)} /></td>
                  <td className="siyam-money">{line.autoPhotoFor ? <strong>{formatMoney(line.lineTotal, currencySymbol)}</strong> : <input className="siyam-price-input siyam-final-price" aria-label={`Final price for ${line.itemName}`} title="Line total after line discount, before checkout discount, service charge and tax" type="number" min="0" step="any" disabled={saving} value={Number(line.lineTotal.toFixed(4))} onChange={event => applyAdjustment([lineKey], 'lineTotal', event.target.value)} />}</td>
                  <td className="siyam-staff-cell"><div className="siyam-inline-staff">
                    {storeAttendantPool && <span className="text-xs text-slate-500">Store attendants · 5% shared ({formatMoney(storePoolPreview, currencySymbol)})</span>}
                    {(['seller', 'guide', 'video'] as const).filter(role => personalRoles.includes(role)).map(role => {
                      const label = role === 'seller' ? 'Seller' : role === 'guide' ? 'Guide' : 'Video';
                      return <label key={role}><span>{label}</span><select aria-label={`${label} for ${line.itemName}`} disabled={!staffReady || saving} value={line[`${role}StaffId`] || ''} onChange={event => updateStaffAssignment(idx, role, event.target.value)}><option value="">Select {label.toLowerCase()}…</option>{staffList.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label>;
                    })}
                    {(['instructor', 'photo'] as const).filter(role => personalRoles.includes(role)).map(role => {
                      const label = role === 'photo' ? 'Photo staff' : 'Instructors';
                      const ids = role === 'photo' ? photoIds(line) : instructorIds(line);
                      return <label key={role}><span>{label}</span><select multiple size={2} aria-label={`${label} for ${line.itemName}`} title="Hold Ctrl or ⌘ to select more than one staff member" disabled={!staffReady || saving} value={ids} onChange={event => {
                        const selectedIds = Array.from(event.target.selectedOptions, option => option.value);
                        setBillLines(lines => lines.map((value, index) => index === idx ? role === 'photo' ? { ...value, photoStaffIds: selectedIds, photoStaffId: selectedIds[0] || null } : { ...value, instructorStaffIds: selectedIds, instructorStaffId: selectedIds[0] || null } : value));
                      }}>{staffList.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label>;
                    })}
                    {!personalRoles.length && !storeAttendantPool && <span className="text-slate-400">—</span>}
                  </div></td>
                  <td className="siyam-remove-cell"><button type="button" className="line-remove-button" aria-label={line.autoPhotoFor ? 'Photo is linked to its activity' : `Remove ${line.itemName}`} disabled={saving || Boolean(line.autoPhotoFor)} onClick={() => removeLine(idx)}><Trash2 size={15} /></button></td>
                </tr>;
            })}
          </LineList>
        )}

        {compactBilling && selected.length > 0 && <div className="siyam-selection-toolbar" role="group" aria-label="Adjust selected products">
          <span aria-live="polite">{selected.length} selected</span>
          <button type="button" className="text-button" disabled={saving || !selected.length} onClick={() => setSelectedKeys([])}>Clear selection</button>
          <label>Change<select aria-label="Selected product adjustment" value={adjustmentKind} disabled={saving} onChange={event => setAdjustmentKind(event.target.value as PriceAdjustment)}><option value="discountPercent">Discount (%)</option><option value="unitPrice" disabled={selectedPhoto}>Unit price ({currencySymbol})</option><option value="lineTotal" disabled={selectedPhoto}>Final line price ({currencySymbol})</option></select></label>
          <label>Value<input aria-label="Selected product value" type="number" min="0" max={adjustmentKind === 'discountPercent' ? 100 : undefined} step="any" value={adjustmentValue} disabled={saving} onChange={event => setAdjustmentValue(event.target.value)} /></label>
          <button type="button" className="secondary-button" disabled={saving || !selected.length || !adjustmentValue.trim() || (selectedPhoto && adjustmentKind !== 'discountPercent')} onClick={() => applyAdjustment(selectedKeys, adjustmentKind, adjustmentValue)}>Apply to selected</button>
          {selectedPhoto && <small>Linked Photo lines support discounts only.</small>}
        </div>}

        {!compactBilling && <div className="space-y-4">
        {/* Tip & Notes */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!compactBilling && <TipControl model={model} />}

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
        {!compactBilling && <DiscountControl model={model} />}
        {/* Running Totals Breakdown Flow (PDF Page 3) */}
        {/* Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net */}
        </div>}
        {!compactBilling && <BillTotals model={model} />}

      </div>
    </div>
  );
}

function LineList({ compact, children }: { compact: boolean; children: ReactNode }) {
  return compact ? <div className="siyam-table-scroll" role="region" aria-label="Bill lines" tabIndex={0}><p className="siyam-table-cue">Scroll horizontally for totals and staff <span aria-hidden="true">→</span></p><table className="siyam-lines-table"><caption className="sr-only">Click a service row to select it. Ctrl-click or Command-click selects multiple services. Use Enter or Space on a focused row to select it.</caption><colgroup><col style={{ width: 140 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 105 }} /><col style={{ width: 125 }} /><col style={{ width: 260 }} /><col style={{ width: 44 }} /></colgroup><thead><tr><th scope="col">Qty</th><th scope="col">Description</th><th scope="col" className="siyam-money">Unit price</th><th scope="col" className="siyam-discount-cell">Discount %</th><th scope="col" className="siyam-money">Total</th><th scope="col">Commission staff</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead><tbody>{children}</tbody></table></div> : <div className="space-y-3 bill-lines">{children}</div>;
}
