import { passwordHelp, passwordPattern } from '../PasswordRecoveryView';
import { Modal } from '../Modal';

import type { AdminModel } from './useAdminController';

export function StaffDialog({ model }: { model: AdminModel }) {
  const {
    activeProperty, editingStaff, errorMsg, giveStaffLogin,
    handleSaveStaff, roleTitles, setErrorMsg, setGiveStaffLogin,
    setShowStaffModal, setStaffForm, setStaffLogin, showStaffModal,
    staffBusy, staffForm, staffLogin,
  } = model;
  return (
    <>
      {/* MODAL: ADD STAFF */}
      {showStaffModal && (
        <Modal label={editingStaff ? "Edit team member" : "Add team member"} busy={staffBusy} onClose={() => { if (!staffBusy) { setShowStaffModal(false); setStaffLogin({ username: '', password: '' }); setGiveStaffLogin(false); setErrorMsg(null); } } } error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {editingStaff ? 'Edit Staff Member in' : 'Add Staff Member to'} {activeProperty?.name}
            </h3>
            <form onSubmit={handleSaveStaff} className="space-y-3 text-sm"><fieldset disabled={staffBusy} className="space-y-3">
              <div>
                <label htmlFor="adminview-field-11" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Full Name *
                </label>
                <input id="adminview-field-11"
                  type="text"
                  required
                  maxLength={200} minLength={2}
                  value={staffForm.name}
                  onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                  placeholder="e.g. Elena Petrova"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <label className="block font-semibold">ER no. (optional)<input id="staff-er-number" type="text" maxLength={100} value={staffForm.erNumber} onChange={event => setStaffForm({ ...staffForm, erNumber: event.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" /></label>
              <label className="block font-semibold">Email (optional)<input type="email" maxLength={254} value={staffForm.email} onChange={event => setStaffForm({ ...staffForm, email: event.target.value })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" /></label>
              {editingStaff && <label className="flex items-center gap-2"><input type="checkbox" checked={staffForm.isActive} onChange={event => setStaffForm({ ...staffForm, isActive: event.target.checked })} />Active staff member</label>}
              <div>
                <label htmlFor="adminview-field-12" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Role Title *
                </label>
                <select id="adminview-field-12"
                  value={staffForm.roleTitle}
                  onChange={(e) => {
                    const title = e.target.value;
                    const isBL = title === 'Base Leader';
                    const isCourse = ['Base Leader', 'Assistant Base Leader', 'Instructor'].includes(title);
                    setStaffForm({
                      ...staffForm,
                      roleTitle: title,
                      isBaseLeaderOverride: isBL,
                      isCoursePoolSharing: isCourse,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                >
                  {[...new Set([staffForm.roleTitle, ...roleTitles])].map(title => (
                    <option key={title} value={title}>{title === 'Receptionist' ? 'Receptionist (Non-dive)' : title}</option>
                  ))}
                </select>
              </div>

              <div className="staff-employment-dates grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="adminview-field-13" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Hire Date *
                  </label>
                  <input id="adminview-field-13"
                    type="date"
                    required
                    value={staffForm.hireDate}
                    onChange={(e) => setStaffForm({ ...staffForm, hireDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="adminview-field-14" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Leaving Date (optional)
                  </label>
                  <input id="adminview-field-14"
                    type="date"
                    value={staffForm.leavingDate}
                    onChange={(e) => setStaffForm({ ...staffForm, leavingDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
              </div>

              {!editingStaff && <fieldset className="space-y-3 border-t border-slate-200 pt-3">
                <legend>Workspace access</legend>
                <label className="flex items-center gap-2"><input type="checkbox" checked={giveStaffLogin} onChange={e => setGiveStaffLogin(e.target.checked)} />Give this staff member login access</label>
                {giveStaffLogin && <>
                  <label className="block" htmlFor="staff-login-username">Unique username<input id="staff-login-username" className="w-full border rounded p-2 mt-1" required minLength={3} maxLength={100} pattern="[A-Za-z0-9._@+\-]+" autoComplete="off" value={staffLogin.username} onChange={e => setStaffLogin({ ...staffLogin, username: e.target.value })} /><span className="required-mark" aria-hidden="true">*</span></label>
                  <label className="block" htmlFor="staff-login-password">Temporary password<input id="staff-login-password" className="w-full border rounded p-2 mt-1" type="password" autoComplete="new-password" required minLength={12} pattern={passwordPattern} title={passwordHelp} value={staffLogin.password} onChange={e => setStaffLogin({ ...staffLogin, password: e.target.value })} /><span className="required-mark" aria-hidden="true">*</span></label>
                  <p className="text-xs text-slate-500">{passwordHelp} This grants centre staff access to {activeProperty?.name}. They must change the temporary password and set up their own authenticator.</p>
                </>}
              </fieldset>}

              {/* Pool checkboxes */}
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isDiveStaff}
                    onChange={(e) => setStaffForm({ ...staffForm, isDiveStaff: e.target.checked })}
                  />
                  <span>Dive staff (Appears in Presence & Attendance register)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isCoursePoolSharing}
                    onChange={(e) => setStaffForm({ ...staffForm, isCoursePoolSharing: e.target.checked })}
                  />
                  <span>Shares in Course Pool (Base Leader, Asst, Instructor)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isDivePoolSharing}
                    onChange={(e) => setStaffForm({ ...staffForm, isDivePoolSharing: e.target.checked })}
                  />
                  <span>Shares in Dive Pool (All dive staff)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isBaseLeaderOverride}
                    onChange={(e) => setStaffForm({ ...staffForm, isBaseLeaderOverride: e.target.checked })}
                  />
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    Base Leader Override (+10% extra of total pool)
                  </span>
                </label>
              </div>

              <div className="dialog-actions flex">
                <button
                  type="button"
                  onClick={() => { setShowStaffModal(false); setStaffLogin({ username: '', password: '' }); setGiveStaffLogin(false); }}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {staffBusy ? 'Saving…' : editingStaff ? 'Save changes' : 'Add Staff Member'}
                </button>
              </div>
              </fieldset>
            </form>
          </div>
        </Modal>
      )}

    </>
  );
}
