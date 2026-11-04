import { formatMoney } from '../../utils/format';
import { Modal } from '../Modal';
import { displayDate } from '../../utils/dates';

import { CheckCircle2 } from 'lucide-react';
import type { BillModel } from './useBillController';

export function BillDialogs({ model }: { model: BillModel }) {
  const {
    applyPmsGuest, billLines, businessDate, checkNumber,
    checkoutDiscountPercent, checkoutPreview, currencySymbol, discardDraft,
    discardOpen, editingBill, errorMsg, guestName,
    guestPickerOpen, handleSaveBill, monthLock, netTotal,
    pmsGuests, roomNumber, saving, selectedPmsGuest,
    setDiscardOpen, setErrorMsg, setGuestPickerOpen, setSelectedPmsGuest,
    setShowConfirmModal, showConfirmModal,
  } = model;
  return (
    <>
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
      {discardOpen && <Modal label="Discard bill draft?" onClose={() => setDiscardOpen(false)}><div className="surface guard-dialog"><h2>Discard this draft?</h2><p>{editingBill ? 'Your unsaved corrections will be discarded. The posted bill will remain unchanged.' : 'The guest details and selected activities will be removed from this tab.'}</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDiscardOpen(false)}>Keep draft</button><button className="danger-button" onClick={discardDraft}>Discard draft</button></div></div></Modal>}
      {/* Confirmation Modal */}
      {showConfirmModal && (
        <Modal label="Review bill" onClose={() => { if (!saving) { setShowConfirmModal(false); setErrorMsg(null); } }} busy={saving} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Save Bill #{checkNumber}?
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Posting check #{checkNumber} for <strong>{guestName}</strong> (Room {roomNumber}).
              Total net charge: <strong>{formatMoney(netTotal, currencySymbol)}</strong>.
            </p>

            <ul className="review-lines">{checkoutPreview.lines.map((line, index) => <li key={index}><span>{line.quantity} × {line.itemName}{line.discountPercent > 0 ? ` · ${line.discountPercent.toLocaleString('en-US', { maximumFractionDigits: 4 })}% total discount` : ''}</span><strong>{formatMoney(line.lineTotal, currencySymbol)}</strong></li>)}</ul>
            {checkoutPreview.amount > 0 && <p>Checkout discount: <strong>{formatMoney(checkoutPreview.amount, currencySymbol)}</strong> ({checkoutDiscountPercent}%), before charges and tax.</p>}
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

            <div className="dialog-actions flex">
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

    </>
  );
}
