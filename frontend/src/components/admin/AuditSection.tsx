import { auditDetailsSummary } from '../../utils/auditPresentation';
import { TableScroll } from '../TableScroll';

import { History } from 'lucide-react';
import type { AdminModel } from './useAdminController';

export function AuditSection({ model }: { model: AdminModel }) {
  const {
    activeTab, auditCursor, auditLogs,
    loadAuditLogs, loading,
  } = model;
  return (
    <>
      {/* TAB 5: AUDIT CHANGE LOG */}
      {activeTab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <History className="w-5 h-5 text-sky-500" />
              <span>Change log</span>
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Maldives time (UTC+05:00).
            </p>
          </div>

          <TableScroll label="Audit history" className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Property</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-GB', { timeZone: 'Indian/Maldives', hour12: false })}
                    </td>
                    <td className="py-3 px-4">{log.property?.name || 'Account / System'}</td>
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                      {log.user?.name || 'System / Guest'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">
                      {log.ipAddress || '127.0.0.1'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 text-sm max-w-md break-words">
                      <p>{auditDetailsSummary(log.details)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {!loading && !auditLogs.length && <p>No audit activity recorded.</p>}
          <div className="flex gap-3">
            <button type="button" disabled={loading} onClick={() => loadAuditLogs()}>Refresh</button>
            {auditCursor && <button type="button" disabled={loading} onClick={() => loadAuditLogs(auditCursor)}>Load older entries</button>}
          </div>
        </div>
      )}

    </>
  );
}
