import { pmsResortCodes } from '../../utils/pmsGuests';
import { formatMoney, formatUnitPrice } from '../../utils/format';

import { Plus, Edit2, Trash2 } from 'lucide-react';
import type { AdminModel } from './useAdminController';

export function PropertiesSection({ model }: { model: AdminModel }) {
  const {
    activeTab, isGlobalAdmin, onSectionChange, openPropertyForm,
    pmsSavingProperty, properties, setActiveProperty, setDeletePropertyCode,
    setDeletePropertyTarget, setErrorMsg, updatePmsCode,
  } = model;
  return (
    <>
      {/* TAB 1: PROPERTIES (Global Admin) */}
      {activeTab === 'properties' && isGlobalAdmin && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Dive Centres / Properties ({properties.length})
              </h3>

            </div>
            <button
              onClick={() => openPropertyForm()}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>New Property</span>
            </button>
          </div>

          {!properties.length && <p className="empty-state">No properties yet. Select New Property to create your first dive centre.</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {properties.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-sm font-bold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded">
                      {p.code}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      {p.name}
                    </h4>
                    <span className="text-xs text-slate-400">{p.location || 'Maldives'}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <button type="button" className="text-button" disabled={pmsSavingProperty !== null} aria-label={`Edit property ${p.name}`} onClick={() => openPropertyForm(p)}><Edit2 size={15} /> Edit property</button>
                <button type="button" className="text-button text-red-600 dark:text-red-400" aria-label={`Delete property ${p.name}`} onClick={() => { setErrorMsg(null); setDeletePropertyCode(''); setDeletePropertyTarget(p); }}><Trash2 size={15} /> Delete property</button>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="secondary-button" onClick={() => { setActiveProperty(p); onSectionChange('items'); }}>Customize catalogue</button>
                  <button type="button" className="secondary-button" onClick={() => { setActiveProperty(p); onSectionChange('commissions'); }}>Customize commission rules</button>
                </div>
                <fieldset disabled={pmsSavingProperty !== null} className="space-y-2 text-sm">
                  <legend>PMS resorts for room lookups</legend>
                  <div className="flex flex-wrap gap-3">{pmsResortCodes.map(code => {
                    const selected = p.pmsPropertyCodes?.length ? p.pmsPropertyCodes : p.pmsPropertyCode ? [p.pmsPropertyCode] : [];
                    return <label key={code} className="flex items-center gap-1"><input type="checkbox" aria-label={`${code} for ${p.name}`} checked={selected.includes(code)} onChange={e => void updatePmsCode(p.id, e.target.checked ? [...selected, code] : selected.filter(value => value !== code))} />{code}</label>;
                  })}</div>
                  <p className="text-xs text-slate-500">Room lookups search every selected resort. With none selected, the centre code is used if supported.</p>
                </fieldset>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/60 text-sm">
                  <div>
                    <span className="text-slate-400 block text-xs">Tax Rate:</span>
                    <span className="font-semibold">{p.taxRate}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-xs">Service Charge:</span>
                    <span className="font-semibold">{p.serviceChargeRate}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-xs">Next Check #:</span>
                    <span className="font-mono font-bold text-sky-500">#{p.nextCheckNumber}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-xs">Photo Line Price:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatUnitPrice(p.autoPhotoPrice ?? 41.975, p.currencySymbol)} <span className="text-[10px] text-slate-400 font-normal block">+tax & SC</span></span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-xs">Photo Commission:</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">{formatMoney(p.autoPhotoCommission ?? 4.5, p.currencySymbol)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </>
  );
}
