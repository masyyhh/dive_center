import { passwordHelp, passwordPattern } from '../PasswordRecoveryView';
import { Modal } from '../Modal';

import { KeyRound } from 'lucide-react';
import type { AdminModel } from './useAdminController';

export function AccountDialogs({ model }: { model: AdminModel }) {
  const {
    closePasswordReset, closeUserDelete, confirmPassword, deleteUserTarget,
    deleteUsername, editingUser, errorMsg, handleDeleteUser,
    handleResetPassword, handleSaveUser, isGlobalAdmin, newPassword,
    properties, resetAuthenticator, resetBusy, resetTargetUser,
    setConfirmPassword, setDeleteUsername, setErrorMsg, setNewPassword,
    setResetAuthenticator, setShowUserModal, setUserForm, showUserModal,
    user, userDeleting, userForm, userSaving,
  } = model;
  return (
    <>
      {isGlobalAdmin && deleteUserTarget && <Modal label={`Delete user ${deleteUserTarget.username}`} busy={userDeleting} onClose={closeUserDelete} error={errorMsg}>
        <form className="surface guard-dialog" onSubmit={handleDeleteUser} aria-busy={userDeleting}>
          <h2>Delete {deleteUserTarget.name}?</h2>
          <p>This revokes sign-in access and removes this account from the user list. Bills, staff roster records, payroll and audit history are retained. The username remains reserved.</p>
          <label htmlFor="delete-user-username">Type <strong>{deleteUserTarget.username}</strong> to confirm.<span className="required-mark" aria-hidden="true">*</span></label>
          <input id="delete-user-username" className="field-input" autoComplete="off" spellCheck={false} required disabled={userDeleting} value={deleteUsername} onChange={e => setDeleteUsername(e.target.value)} />
          <div className="dialog-actions"><button type="button" className="secondary-button" disabled={userDeleting} onClick={closeUserDelete}>Cancel</button><button type="submit" className="danger-button" disabled={userDeleting || deleteUsername.trim().toLowerCase() !== deleteUserTarget.username}>{userDeleting ? 'Deleting…' : 'Delete user'}</button></div>
        </form>
      </Modal>}

      {/* MODAL: CREATE / EDIT USER */}
      {showUserModal && (
        <Modal label={editingUser ? `Edit user ${editingUser.username}` : 'Create account'} busy={userSaving} onClose={() => { if (!userSaving) { setShowUserModal(false); setErrorMsg(null); } } } error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {editingUser ? 'Edit User Account' : 'Create New User Account'}
            </h3>
            {!editingUser && <p className="text-sm text-slate-500">{passwordHelp} Share the username and temporary password directly with the user. They must change their password and bind their own authenticator before using the workspace.</p>}
            <form onSubmit={handleSaveUser} className="space-y-3 text-sm" aria-busy={userSaving}>
              <fieldset disabled={userSaving} className="space-y-3">
                <div>
                  <label htmlFor="adminview-field-7" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Full Name *
                  </label>
                  <input id="adminview-field-7"
                    type="text"
                    required
                    value={userForm.name}
                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                    placeholder="e.g. Hassan Rauf"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="account-username" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Unique Username *</label>
                  <input id="account-username" autoComplete="off" required minLength={3} maxLength={100} pattern="[A-Za-z0-9._@+\-]+" value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="e.g. hassan.male" className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
                  <p className="text-xs text-slate-500 mt-1">Every person needs their own username and authenticator, even when sharing an email address.</p>
                </div>
                <div>
                  <label htmlFor="adminview-field-8" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Email Address (optional; shared addresses allowed)
                  </label>
                  <input id="adminview-field-8"
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    placeholder="hassan@sundiving.com"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>

                {!editingUser && <div>
                  <label htmlFor="adminview-field-9" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Temporary Password *
                  </label>
                  <input id="adminview-field-9"
                    type="password"
                    required
                    minLength={12} pattern={passwordPattern} title={passwordHelp}
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    placeholder="12 characters, Aa, number, symbol"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>}

                <div>
                  <label htmlFor="adminview-field-10" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Role *
                  </label>
                  <select id="adminview-field-10"
                    disabled={editingUser?.id === user?.id}
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  >
                    <option value="CENTRE_STAFF">Centre Staff (Fixed to assigned centre)</option>
                    {isGlobalAdmin && <option value="PROPERTY_MANAGER">Property Manager (Multiple assigned centres)</option>}
                    {isGlobalAdmin && <option value="GLOBAL_ADMIN">Global Admin (Unrestricted system-wide)</option>}
                  </select>
                </div>

                {editingUser && <label className="flex items-center gap-2"><input type="checkbox" disabled={editingUser.id === user?.id} checked={userForm.isActive} onChange={e => setUserForm({ ...userForm, isActive: e.target.checked })} /> Active account</label>}
                {editingUser?.id === user?.id && <p className="text-xs text-slate-500">Your administrator role and active status are protected while you are signed in.</p>}
                {userForm.role !== 'GLOBAL_ADMIN' && (
                  <div>
                    <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Assign Properties:
                    </label>
                    <div className="space-y-1 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 max-h-36 overflow-y-auto">
                      {properties.filter(p => (p.isActive || editingUser?.assignedProperties.some(assigned => assigned.id === p.id)) && (isGlobalAdmin || user?.assignedProperties.some(assigned => assigned.id === p.id))).map((p) => {
                        const isChecked = userForm.propertyIds.includes(p.id);
                        return (
                          <label key={p.id} className="flex items-center space-x-2 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setUserForm({ ...userForm, propertyIds: [...userForm.propertyIds, p.id] });
                                } else {
                                  setUserForm({
                                    ...userForm,
                                    propertyIds: userForm.propertyIds.filter((id) => id !== p.id),
                                  });
                                }
                              }}
                            />
                            <span>{p.name} ({p.code}){!p.isActive ? ' · Inactive' : ''}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

              </fieldset>
              <div className="dialog-actions flex">
                <button
                  type="button"
                  disabled={userSaving}
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={userSaving}
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {userSaving ? 'Saving…' : editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* MODAL: RESET PASSWORD */}
      {resetTargetUser && (
        <Modal label="Reset password" onClose={closePasswordReset} busy={resetBusy} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <KeyRound className="w-5 h-5 text-amber-500" />
              <span>Set Password for {resetTargetUser.name}</span>
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Set a temporary password and share it directly with the user. They must change it at next sign-in. This also clears the sign-in lock.
            </p>

            <p className="text-sm text-slate-500">{passwordHelp}</p>
            <form onSubmit={handleResetPassword} className="space-y-3 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" checked={resetAuthenticator} disabled={resetBusy} onChange={e => setResetAuthenticator(e.target.checked)} /><span>User lost their authenticator and recovery codes. Clear their binding so they can bind a new authenticator after changing this temporary password.</span></label>
              <div>
                <label htmlFor="reset-new-password" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  New Password:
                <span className="required-mark" aria-hidden="true">*</span></label>
                <input
                  type="password"
                  required
                  minLength={12} pattern={passwordPattern} title={passwordHelp}
                  id="reset-new-password"
                  autoComplete="new-password"
                  disabled={resetBusy}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Confirm password:<span className="required-mark" aria-hidden="true">*</span></label>
                <input id="reset-confirm-password" type="password" autoComplete="new-password" required minLength={12} pattern={passwordPattern} title={passwordHelp} disabled={resetBusy}
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
              </div>

              <div className="dialog-actions flex">
                <button
                  type="button"
                  disabled={resetBusy}
                  onClick={closePasswordReset}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold transition"
                >
                  {resetBusy ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

    </>
  );
}
