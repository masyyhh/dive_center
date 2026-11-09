import { TableScroll } from '../TableScroll';

import { Plus } from 'lucide-react';
import type { AdminModel } from './useAdminController';

export function StaffSection({ model }: { model: AdminModel }) {
  const {
    activeProperty, activeTab, canManageAccounts, handleCreateRoleTitle,
    newRoleTitle, openStaffEditor, roleTitleBusy, roleTitlesLoading,
    setNewRoleTitle, staffBusy, staffList,
  } = model;
  return (
    <>
      {/* TAB 3: STAFF ROSTER & POOL RULES */}
      {activeTab === 'staff' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Staff Roster for {activeProperty?.name} ({staffList.length})
              </h3>

            </div>
            <button
              onClick={() => openStaffEditor()}
              disabled={!canManageAccounts || !activeProperty || staffBusy}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Staff</span>
            </button>
          </div>

          {canManageAccounts && <form onSubmit={handleCreateRoleTitle} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 space-y-2">
            <label htmlFor="new-staff-role-title" className="block text-sm font-semibold">Add role title</label>
            <div className="flex flex-wrap gap-2">
              <input id="new-staff-role-title" value={newRoleTitle} onChange={event => setNewRoleTitle(event.target.value)}
                required minLength={2} maxLength={100} disabled={!activeProperty || roleTitleBusy || roleTitlesLoading}
                placeholder="e.g. Marine Biologist" className="flex-1 min-w-48 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700" />
              <button type="submit" disabled={!activeProperty || roleTitleBusy || roleTitlesLoading || newRoleTitle.trim().length < 2}
                className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold disabled:opacity-50">
                {roleTitleBusy ? 'Adding…' : 'Add role title'}
              </button>
            </div>
            <p className="text-xs text-slate-500">Saved for {activeProperty?.name || 'the selected property'} and available when adding staff. Configure pool sharing for each staff member.</p>
          </form>}

          <TableScroll paginate label="Staff roster" className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Name & Title</th>
                  <th className="py-3 px-4">Employment Window</th>
                  <th className="py-3 px-4">Login access</th>
                  <th className="py-3 px-4">Dive Staff?</th>
                  <th className="py-3 px-4">Course Pool</th>
                  <th className="py-3 px-4">Dive Pool</th>
                  <th className="py-3 px-4">BL Override (+10%)</th>
                  {canManageAccounts && <th className="py-3 px-4">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {staffList.length === 0 && <tr><td colSpan={10} className="py-12 text-center text-slate-500">No team members yet. Add dive staff to start recording attendance.</td></tr>}
                {staffList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                      <div className="text-xs text-slate-400">{s.roleTitle}</div>
                      {s.erNumber && <div className="text-xs text-slate-500">ER no.: {s.erNumber}</div>}
                      {!s.isActive && <span className="status-badge status-deleted">Inactive</span>}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      Hired: {s.hireDate} {s.leavingDate ? `• Left: ${s.leavingDate}` : s.isActive ? '• Active' : '• Inactive'}
                    </td>
                    <td className="py-3 px-4">{s.userId ? 'Login account created' : 'No linked login'}</td>
                    <td className="py-3 px-4">
                      {s.isDiveStaff ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                          Yes (Presence active)
                        </span>
                      ) : (
                        <span className="text-slate-400">No (Excluded from presence)</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.isCoursePoolSharing ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ Sharing</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.isDivePoolSharing ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ Sharing</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.isBaseLeaderOverride ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          +10% Extra
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    {canManageAccounts && <td className="py-3 px-4"><button type="button" className="secondary-button" disabled={staffBusy} aria-label={`Edit staff ${s.name}`} onClick={() => openStaffEditor(s)}>Edit staff</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}

    </>
  );
}
