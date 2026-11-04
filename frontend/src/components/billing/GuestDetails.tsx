import { isRoomNumber, roomNumberHelp } from '../../utils/inputValidation';
import { nationalityCountries as countries } from '../../utils/nationalities';
import { businessToday } from '../../utils/dates';

import { Search, UserCheck } from 'lucide-react';
import type { BillModel } from './useBillController';

export function GuestDetails({ model }: { model: BillModel }) {
  const {
    attemptedReview, compactBilling, businessDate, cancelPmsLookup, departureDate,
    guestName, lookupGuests, nationality, pmsBusy,
    pmsError, pmsGuests, pmsMessage, roomNumber,
    saving, setDepartureDate, setGuestName, setGuestPickerOpen,
    setNationality, setRoomNumber, setSelectedPmsGuest,
  } = model;
  const optionalFields = <>
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
  </>;
  const Heading = 'h3';
  const content = <>
      <Heading className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
        <UserCheck className="w-4 h-4 text-sky-500" />
        <span>{compactBilling ? 'Guest details' : '2. Guest details'}</span>
      </Heading>
      {!compactBilling && <p className="workflow-section-help">* Required fields.</p>}


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
              id="bill-room" inputMode="numeric" pattern="[0-9]{1,32}" maxLength={32}
              aria-label="Room number"
              aria-required="true"
              aria-invalid={(attemptedReview || roomNumber.length > 0) && !isRoomNumber(roomNumber)}
              aria-describedby="room-help room-error"
              value={roomNumber}
              onChange={(e) => { cancelPmsLookup(); setRoomNumber(e.target.value); }}
              placeholder="e.g. 304"
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button type="button" className="secondary-button" onClick={lookupGuests} disabled={!isRoomNumber(roomNumber) || pmsBusy || saving || businessDate !== businessToday()} aria-busy={pmsBusy} aria-label="Look up in-house guests for this room"><Search size={16} />{pmsBusy ? 'Looking up…' : 'Find guests'}</button>
          </div>
          {businessDate !== businessToday() && <p className="field-help">PMS lookup shows guests in-house today. Enter details manually for a different business date.</p>}
          {pmsGuests.length > 0 && <button type="button" className="text-button" disabled={saving} onClick={() => { setSelectedPmsGuest(null); setGuestPickerOpen(true); }}>Choose a guest from this room ({pmsGuests.length})</button>}
          <p id="room-help" className="field-help">{compactBilling ? 'Digits only; leading zeros kept.' : 'Digits only. Leading zeros are kept, e.g. 0012.'}</p>
          {(attemptedReview || roomNumber.length > 0) && !isRoomNumber(roomNumber) && <p id="room-error" className="field-error" role="alert">{roomNumberHelp}</p>}
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

        {optionalFields}
      </div>
  </>;
  const className = "bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4";
  return <div id="bill-guest-details" className={className}>{content}</div>;
}
