import { TableScroll } from '../TableScroll';
import { PersonalCommissionSummary } from '../PersonalCommissionEditor';
import { usesStoreAttendantPool } from '../../utils/storeAttendantPool';
import { CatalogueFilters, emptyCatalogueFilters } from '../../utils/catalogueFilters';
import { CatalogueTransferPanel } from '../CatalogueTransferPanel';
import { CatalogueImportReview } from '../CatalogueImportReview';
import { formatMoney } from '../../utils/format';

import { Plus, Edit2, Trash2 } from 'lucide-react';
import type { AdminModel } from './useAdminController';

export function CatalogueSection({ model }: { model: AdminModel }) {
  const {
    activeProperty, activeTab, bulkBusy, canPermanentlyDeleteSelected,
    catalogueFilters, catalogueImport, categories, commitCatalogue,
    eligibleVisibleItems, exportCatalogue, handleRestoreItem, itemBusy,
    items, loading, openItemEditor, photoCommissionLabel,
    photoPriceLabel, photoSettings, previewCatalogue, reviewBulkMedia,
    selectableItems, selectedAreActive, selectedItemIds, selectedItems,
    selectedVisibleCount, setBulkDeleteTarget, setCatalogueFilters, setCatalogueImport,
    setDeleteItemTarget, setErrorMsg, setSelectedItemIds, setShowArchivedItems,
    showArchivedItems, toggleComplimentaryMedia, transferBusy, viewItems,
    visibleItems,
  } = model;
  return (
    <>
      {/* TAB 4: ITEM CATALOGUE */}
      {activeTab === 'items' && (
        <div className="catalogue-workspace bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="catalogue-heading flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Activity catalogue
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Changes apply to new bills.
              </p>
            </div>
            <button
              onClick={() => openItemEditor()}
              disabled={!activeProperty || loading || itemBusy}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add activity</span>
            </button>
          </div>

          <details className="catalogue-transfer-tools">
            <summary>Import &amp; export <span>CSV / Excel</span></summary>
          <CatalogueTransferPanel {...photoSettings} currencySymbol={activeProperty?.currencySymbol} propertyName={activeProperty?.name} available={Boolean(activeProperty)} busy={transferBusy}
            onExport={exportCatalogue} onImport={previewCatalogue} />
          </details>
          {catalogueImport?.propertyId === activeProperty?.id && catalogueImport && <CatalogueImportReview data={catalogueImport}
            fileName={catalogueImport.fileName} propertyName={activeProperty?.name || ''} currencySymbol={activeProperty?.currencySymbol || '$'}
            busy={transferBusy} onApply={commitCatalogue} onCancel={() => setCatalogueImport(null)} />}

          <div className="catalogue-view-header">
            <div className="catalogue-view-switch" role="group" aria-label="Catalogue view">
              <button type="button" aria-pressed={!showArchivedItems} disabled={itemBusy || bulkBusy} onClick={() => setShowArchivedItems(false)}>Active <span>{items.filter(item => item.isActive).length}</span></button>
              <button type="button" aria-pressed={showArchivedItems} disabled={itemBusy || bulkBusy} onClick={() => setShowArchivedItems(true)}>Deleted <span>{items.filter(item => !item.isActive).length}</span></button>
            </div>
            <div className="catalogue-results"><span role="status">{visibleItems.length} of {viewItems.length} activities</span><button type="button" className="text-button" onClick={() => setCatalogueFilters(emptyCatalogueFilters)}>Clear filters</button></div>
          </div>
          <div className="catalogue-filters">
            <label>Search activities<input type="search" placeholder="Name, code or category" value={catalogueFilters.query} onChange={event => setCatalogueFilters({ ...catalogueFilters, query: event.target.value })} /></label>
            <label>Category<select value={catalogueFilters.categoryId} onChange={event => setCatalogueFilters({ ...catalogueFilters, categoryId: event.target.value })}><option value="">All categories</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Pool<select value={catalogueFilters.poolType} onChange={event => setCatalogueFilters({ ...catalogueFilters, poolType: event.target.value })}><option value="">All pools</option><option value="COURSE_POOL">Course pool</option><option value="DIVE_POOL">Dive pool</option><option value="CERTIFICATION_POOL">Certifications</option><option value="NONE">No pool</option></select></label>
            <label>Photo / video<select value={catalogueFilters.media} onChange={event => setCatalogueFilters({ ...catalogueFilters, media: event.target.value as CatalogueFilters['media'] })}><option value="all">All services</option><option value="included">Photo added · {photoPriceLabel}</option><option value="excluded">Separate settings</option></select></label>
          </div>

          {showArchivedItems && <section className="catalogue-permanent-tools" aria-label="Bulk permanent deletion">
            <div><h4>Bulk permanent deletion</h4><p>{eligibleVisibleItems.length} eligible activities match your filters. Activities with bill or package links are excluded. Up to 200 can be selected at once.</p></div>
            <button type="button" className="secondary-button" disabled={itemBusy || bulkBusy || loading || !eligibleVisibleItems.length} onClick={() => setSelectedItemIds(eligibleVisibleItems.slice(0, 200).map(item => item.id))}>Select eligible activities ({Math.min(eligibleVisibleItems.length, 200)})</button>
          </section>}
          {selectedItemIds.length > 0 && <div className="catalogue-bulk-bar" aria-label="Selected activity actions">
            <div><strong>{selectedItemIds.length} selected</strong>{selectedItemIds.length > selectedVisibleCount && <span> · {selectedItemIds.length - selectedVisibleCount} hidden by filters</span>}<small>Review changes before saving. Up to 200 services per update.</small></div>
            {!showArchivedItems && <><button type="button" className="secondary-button" disabled={bulkBusy || itemBusy || !selectedAreActive} onClick={() => reviewBulkMedia(true)}>{bulkBusy ? 'Preparing review…' : `Add Photo · ${photoPriceLabel}`}</button>
            <button type="button" className="secondary-button" disabled={bulkBusy || itemBusy || !selectedAreActive} onClick={() => reviewBulkMedia(false)}>Stop adding Photo</button>
            <button type="button" className="danger-button" disabled={bulkBusy || itemBusy || !activeProperty || !selectedAreActive} onClick={() => {
              if (!activeProperty) return;
              setErrorMsg(null);
              setBulkDeleteTarget({ propertyId: activeProperty.id, items: items.filter(item => item.isActive && selectedItemIds.includes(item.id)) });
            }}><Trash2 size={14} />Delete selected ({selectedItemIds.length})</button></>}
            {showArchivedItems && <button type="button" className="danger-button" disabled={bulkBusy || itemBusy || !activeProperty || !canPermanentlyDeleteSelected} onClick={() => {
              if (!activeProperty || !canPermanentlyDeleteSelected) return;
              setErrorMsg(null); setBulkDeleteTarget({ propertyId: activeProperty.id, items: selectedItems, permanent: true });
            }}>Permanently delete selected ({selectedItemIds.length})</button>}
            {!selectedAreActive && <p className="text-sm">Permanent deletion is available only when every selected activity has no saved bill or package links. Use Restore on a row to make it available again.</p>}
            <button type="button" className="text-button" disabled={bulkBusy || itemBusy} onClick={() => setSelectedItemIds([])}>Clear selection</button>
          </div>}

          <p className="field-help">Select up to 200 activities for bulk changes.</p>
          <TableScroll paginate label="Catalogue activities" className="overflow-x-auto catalogue-table-region">
            <table className="w-full text-left border-collapse text-sm catalogue-table">
              <caption className="sr-only">{showArchivedItems ? 'Deleted' : 'Active'} activities for {activeProperty?.name}</caption>
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4"><input type="checkbox" aria-label="Select all matching activities across pages"
                    checked={selectableItems.length > 0 && selectedVisibleCount === selectableItems.length}
                    ref={node => { if (node) node.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableItems.length; }}
                    disabled={bulkBusy || itemBusy || !selectableItems.length || (new Set([...selectedItemIds, ...selectableItems.map(item => item.id)]).size > 200 && selectedVisibleCount !== selectableItems.length)}
                    onChange={event => setSelectedItemIds(ids => event.target.checked ? [...new Set([...ids, ...selectableItems.map(item => item.id)])] : ids.filter(id => !selectableItems.some(item => item.id === id)))} /></th>
                  <th className="py-3 px-4">Activity</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 catalogue-amount">Price</th>
                  <th className="py-3 px-4">Pool contribution</th>
                  <th className="py-3 px-4">Employee payments</th>
                  <th className="py-3 px-4">Auto Photo <span className="catalogue-photo-rate">{photoPriceLabel} / unit<br />Staff {photoCommissionLabel} / unit</span></th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {!visibleItems.length && <tr><td colSpan={9} className="py-12 text-center text-slate-500">{viewItems.length ? 'No activities match these filters. Clear filters to see more.' : showArchivedItems ? 'No deleted activities. Activities you delete will appear here.' : 'No active activities. Add an activity or restore one from Deleted.'}</td></tr>}
                {visibleItems.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4"><input type="checkbox" aria-label={`Select ${it.name} for bulk update`} checked={selectedItemIds.includes(it.id)}
                      disabled={bulkBusy || itemBusy || (selectedItemIds.length >= 200 && !selectedItemIds.includes(it.id))}
                      onChange={event => setSelectedItemIds(ids => event.target.checked ? [...new Set([...ids, it.id])] : ids.filter(id => id !== it.id))} /></td>
                    <td className="py-3 px-4">
                      <strong className="catalogue-name">{it.name}</strong>
                      <span className="catalogue-code">{it.code}</span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                      {it.category?.name || 'General'}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white catalogue-amount">
                      {formatMoney(it.price, activeProperty?.currencySymbol || '$')}
                    </td>
                    <td className="py-3 px-4">
                      {it.poolType !== 'NONE' ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                          {{ COURSE_POOL: 'Course pool', DIVE_POOL: 'Dive pool', CERTIFICATION_POOL: 'Certifications', NONE: 'No pool' }[it.poolType]}: {it.poolType === 'COURSE_POOL' || it.poolType === 'DIVE_POOL' ? `${it.poolContribution}%` : formatMoney(it.poolContribution, activeProperty?.currencySymbol || '$')}
                        </span>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <PersonalCommissionSummary storeAttendantPool={usesStoreAttendantPool(activeProperty, it.category?.name)} autoPhotoCommission={photoSettings.autoPhotoCommission} item={it} currencySymbol={activeProperty?.currencySymbol || '$'} />
                    </td>
                    <td className="py-3 px-4"><label className="flex items-start gap-2">
                      <input type="checkbox" checked={it.includesComplimentaryMedia} disabled={itemBusy || bulkBusy || !it.isActive}
                        aria-label={`Automatic Photo for ${it.name}`}
                        onChange={event => toggleComplimentaryMedia(it, event.target.checked)} />
                      <span className="text-xs">{it.includesComplimentaryMedia ? 'On' : 'Off'}</span>
                    </label></td>
                    <td className="py-3 px-4"><span className={`status-badge ${it.isActive ? 'status-active' : 'status-deleted'}`}>{it.isActive ? 'Active' : 'Deleted'}</span></td>
                    <td className="py-3 px-4"><div className="flex gap-2">
                      <button type="button" className="secondary-button" disabled={itemBusy || bulkBusy} onClick={() => openItemEditor(it)} title={`Edit ${it.name}`} aria-label={`Edit ${it.name}`}><Edit2 size={14} /></button>
                      {it.isActive ? <button type="button" className="secondary-button" disabled={itemBusy} onClick={() => { setDeleteItemTarget(it); setErrorMsg(null); }} title={`Delete ${it.name}`} aria-label={`Delete ${it.name}`}><Trash2 size={14} /></button> : <button type="button" className="secondary-button" disabled={itemBusy} onClick={() => handleRestoreItem(it)} aria-label={`Restore ${it.name}`}>Restore</button>}
                      {!it.isActive && <div className="space-y-1"><button type="button" className="danger-button" disabled={itemBusy || bulkBusy || it.hasBillHistory || it.hasPackageUsage} onClick={() => {
                        if (!activeProperty) return;
                        setErrorMsg(null); setBulkDeleteTarget({ propertyId: activeProperty.id, items: [it], permanent: true });
                      }} aria-label={`Permanently delete ${it.name}`}>Delete permanently</button>
                        {(it.hasBillHistory || it.hasPackageUsage) && <small className="block text-slate-500">{it.hasBillHistory ? 'Retained for bill history' : 'Used in a package'}</small>}
                      </div>}
                    </div></td>
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
