import { TableScroll } from '../TableScroll';

import { KeyRound, Unlock, Plus, Edit2, Trash2, Lock } from 'lucide-react';
import type { AdminModel } from './useAdminController';

export function UsersSection({ model }: { model: AdminModel }) {
  const {
    activeTab, canManageAccounts, handleUnlockUser, isGlobalAdmin,
    openUserForm, setConfirmPassword, setDeleteUserTarget, setDeleteUsername,
    setErrorMsg, setNewPassword, setResetTargetUser, user,
    usersList,
  } = model;
  return (
    <>
      {/* TAB 2: USER MANAGEMENT (Global Admin) */}
      {activeTab === 'users' && canManageAccounts && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                User Accounts & Access Control ({usersList.length})
              </h3>

            </div>
            {canManageAccounts && <button
              onClick={() => openUserForm()}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Create User</span>
            </button>}
          </div>

          <TableScroll label="User accounts" className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Name & Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Assigned Centres</th>
                  <th className="py-3 px-4">Security Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {usersList.length === 0 && <tr><td colSpan={10} className="py-12 text-center text-slate-500">{isGlobalAdmin ? 'No user accounts yet. Create an account to give your team access.' : 'No staff accounts yet. Create an account and assign it to your properties.'}</td></tr>}
                {usersList.map((u) => {
                  const isLocked = u.lockedUntil && new Date(u.lockedUntil) > new Date();

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">{u.name}</div>
                        <div className="text-xs text-slate-400">{u.username}{u.email ? ` · ${u.email}` : ''}</div><div className="text-xs text-slate-400">Authenticator: {u.authenticatorEnabled ? 'bound' : 'setup required'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {u.role === 'GLOBAL_ADMIN' ? (
                          <span className="text-purple-600 dark:text-purple-400 font-semibold">
                            All Centres (Global)
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.assignedProperties.map((p) => (
                              <span
                                key={p.id}
                                className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 text-xs font-medium"
                              >
                                {p.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {!u.isActive ? <span className="text-slate-500">Inactive</span> : isLocked ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 flex items-center space-x-1 w-max">
                            <Lock className="w-3 h-3" />
                            <span>Locked (5 wrong passwords)</span>
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Normal (0 failed attempts)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {isGlobalAdmin && <>
                          <button type="button" className="text-button" aria-label={`Edit user ${u.username}`} onClick={() => openUserForm(u)}><Edit2 size={14} /> Edit</button>
                          <button type="button" className="text-button text-red-600 dark:text-red-400" aria-label={`Delete user ${u.username}`} disabled={u.id === user?.id} title={u.id === user?.id ? 'You cannot delete your own administrator account.' : 'Delete user'} onClick={() => { setDeleteUserTarget(u); setDeleteUsername(''); setErrorMsg(null); }}><Trash2 size={14} /> Delete</button>
                        </>}
                        {/* Reset Password Button */}
                        <button
                          onClick={() => { setNewPassword(''); setConfirmPassword(''); setErrorMsg(null); setResetTargetUser(u); }}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-semibold transition inline-flex items-center space-x-1"
                          title="Set user password"
                        >
                          <KeyRound className="w-3 h-3 text-amber-500" />
                          <span>Set Password</span>
                        </button>

                        {/* Unlock Account Button */}
                        {isLocked && isGlobalAdmin && (
                          <button
                            onClick={() => handleUnlockUser(u.id)}
                            className="px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold transition inline-flex items-center space-x-1 shadow-xs"
                            title="Manually unlock this account"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Unlock</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}

    </>
  );
}
