import { CommissionRulesView } from './CommissionRulesView';

import { Shield, CheckCircle, AlertCircle } from 'lucide-react';
import { useAdminController } from './admin/useAdminController';
import type { AdminViewProps } from './admin/useAdminController';
import { PropertiesSection } from './admin/PropertiesSection';
import { UsersSection } from './admin/UsersSection';
import { StaffSection } from './admin/StaffSection';
import { CatalogueSection } from './admin/CatalogueSection';
import { AuditSection } from './admin/AuditSection';
import { PropertyDialogs } from './admin/PropertyDialogs';
import { AccountDialogs } from './admin/AccountDialogs';
import { StaffDialog } from './admin/StaffDialog';
import { CatalogueDialogs } from './admin/CatalogueDialogs';

export function AdminView(props: AdminViewProps) {
  const model = useAdminController(props);
  const {
    activeProperty, activeTab, bulkBusy, canManageAccounts,
    categoryBusy, copyItemRules, errorMsg, isGlobalAdmin,
    itemBusy, items, loading, onSectionChange,
    openItemEditor, properties, requestNavigation, setActiveProperty,
    setErrorMsg, successMsg, transferBusy,
  } = model;
  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="feature-heading bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-sm font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
            <Shield className="w-4 h-4" />
            <span>WORKSPACE SETTINGS</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            Administration
          </h1>
        </div>
        {/* Tab Switcher */}
        <div role="group" aria-label="Administration sections" className="admin-tabs flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-sm font-bold">
          {isGlobalAdmin && (
            <button
              onClick={() => onSectionChange('properties')}
              aria-pressed={activeTab === 'properties'}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'properties'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Properties
            </button>
          )}

          {canManageAccounts && (
            <button
              onClick={() => onSectionChange('users')}
              aria-pressed={activeTab === 'users'}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'users'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              User Accounts
            </button>
          )}

          <button
            onClick={() => onSectionChange('staff')}
              aria-pressed={activeTab === 'staff'}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'staff'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Staff & Pools
          </button>

          <button
            onClick={() => onSectionChange('items')}
              aria-pressed={activeTab === 'items'}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'items'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Catalogue
          </button>

            {canManageAccounts && (
              <button
                type="button"
                onClick={() => onSectionChange('commissions')}
                aria-pressed={activeTab === 'commissions'}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeTab === 'commissions'
                    ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Commission rules
              </button>
            )}

          <button
            onClick={() => onSectionChange('audit')}
              aria-pressed={activeTab === 'audit'}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'audit'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Change Log
          </button>
        </div>
      </div>

      <p className="nav-scroll-cue">More sections: swipe or scroll the tabs <span aria-hidden="true">→</span></p>
      {errorMsg && <div role="alert" className="notice notice-error"><AlertCircle size={18} /><span>{errorMsg}</span><button onClick={() => setErrorMsg(null)}>Dismiss</button></div>}
      {successMsg && (
        <div role="status" className="notice notice-success p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm flex items-center space-x-2">
          <CheckCircle className="w-4 h-4 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {isGlobalAdmin && (activeTab === 'items' || activeTab === 'commissions' || activeTab === 'staff') && <div className={`surface p-4 flex flex-wrap items-center gap-3 ${activeTab === 'items' ? 'catalogue-property-selector' : ''}`}>
        <label htmlFor="customization-property" className="block font-semibold">Property</label>
        <select id="customization-property" value={activeProperty?.id || ''} disabled={itemBusy || bulkBusy || transferBusy || categoryBusy} onChange={event => { const property = properties.find(p => p.id === event.target.value); if (property) requestNavigation(() => setActiveProperty(property)); }}>
          {!activeProperty && <option value="">Choose a property</option>}
          {properties.map(property => <option key={property.id} value={property.id}>{property.name} ({property.code}){property.isActive ? '' : ' · Inactive'}</option>)}
        </select>
      </div>}

      {activeTab === 'commissions' && canManageAccounts && <CommissionRulesView key={activeProperty?.id || 'none'} property={activeProperty} items={items} loading={loading} busy={itemBusy || bulkBusy || categoryBusy} onEdit={openItemEditor} onCopy={copyItemRules} onStaff={() => onSectionChange('staff')} />}

      <PropertiesSection model={model} />
      <UsersSection model={model} />
      <StaffSection model={model} />
      <CatalogueSection model={model} />
      <AuditSection model={model} />
      <PropertyDialogs model={model} />
      <AccountDialogs model={model} />
      <StaffDialog model={model} />
      <CatalogueDialogs model={model} />
    </div>
  );
}
