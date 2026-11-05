import { PersonalCommissionEditor } from '../PersonalCommissionEditor';
import { CommissionCalculatorPreview } from '../CommissionCalculator';
import { BulkMediaReview } from '../BulkMediaReview';
import { Modal } from '../Modal';
import { usesStoreAttendantPool } from '../../utils/storeAttendantPool';

import type { AdminModel } from './useAdminController';

export function CatalogueDialogs({ model }: { model: AdminModel }) {
  const {
    activeProperty, activeTab, applyBulkMedia, bulkBusy,
    bulkDeleteTarget, bulkError, bulkReview, categories,
    categoryBusy, closeItemEditor, commissionSelections, deleteItemNoun,
    deleteItemTarget, editingItem, errorMsg, handleBulkDeleteItems,
    handleCreateCategory, handleDeleteItem, handleSaveItem, itemBusy,
    itemForm, newCategoryName, noCommissions, permanentDeleteConfirmation,
    photoCommissionLabel, photoPriceLabel, photoSettings, previousCommissionSettings,
    reviewBulkMedia, setBulkDeleteTarget, setBulkError, setBulkReview,
    setCommissionSelections, setDeleteItemTarget, setErrorMsg, setItemForm,
    setNewCategoryName, setNoCommissions, setPermanentDeleteConfirmation, setShowCategoryInput,
    showCategoryInput, showItemModal,
  } = model;
  const storeAttendantPool = usesStoreAttendantPool(activeProperty, categories.find(category => category.id === itemForm.categoryId)?.name);
  return (
    <>
      {activeTab === 'items' && bulkDeleteTarget && bulkDeleteTarget.propertyId === activeProperty?.id && <Modal label={bulkDeleteTarget.permanent ? "Permanently delete catalogue activities" : "Delete selected catalogue activities"} busy={itemBusy} onClose={() => { if (!itemBusy) { setBulkDeleteTarget(null); setErrorMsg(null); } }} error={errorMsg}>
        <div className="surface p-6 space-y-4">
          <h3 className="text-lg font-bold">{bulkDeleteTarget.permanent ? 'Permanently delete' : 'Delete'} {bulkDeleteTarget.items.length} selected {deleteItemNoun}?</h3>
          {bulkDeleteTarget.permanent ? <p className="notice notice-error">This permanently removes these catalogue records from {activeProperty?.name}. They cannot be restored. Only deleted activities with no saved bill or package links can be permanently deleted. An audit record is retained.</p> : <p>These activities will be removed from new bills for {activeProperty?.name}. Existing bills and history are retained. You can restore activities from the deleted activities list.</p>}
          <p className="text-sm text-slate-500">All selected activities are included, even those hidden by the current filters.</p>
          <ul className="max-h-60 overflow-y-auto space-y-1" aria-label="Activities to delete">{bulkDeleteTarget.items.map(item => <li key={item.id}><strong>{item.code}</strong> · {item.name}</li>)}</ul>
          {bulkDeleteTarget.permanent && <label className="block" htmlFor="permanent-delete-confirmation">Type <strong>DELETE PERMANENTLY</strong> to confirm.
            <input id="permanent-delete-confirmation" className="field-input w-full mt-2" autoComplete="off" spellCheck={false} disabled={itemBusy} value={permanentDeleteConfirmation} onChange={event => setPermanentDeleteConfirmation(event.target.value)} />
          </label>}
          <div className="dialog-actions">
            <button type="button" className="secondary-button" disabled={itemBusy} onClick={() => { setBulkDeleteTarget(null); setErrorMsg(null); }}>Cancel</button>
            <button type="button" className="danger-button" disabled={itemBusy || !bulkDeleteTarget.items.length || (bulkDeleteTarget.permanent && permanentDeleteConfirmation !== 'DELETE PERMANENTLY')} onClick={handleBulkDeleteItems}>{itemBusy ? 'Deleting…' : `${bulkDeleteTarget.permanent ? 'Permanently delete' : 'Delete'} ${bulkDeleteTarget.items.length} ${deleteItemNoun}`}</button>
          </div>
        </div>
      </Modal>}
      {deleteItemTarget && <Modal label="Delete activity" busy={itemBusy} onClose={() => { if (!itemBusy) { setDeleteItemTarget(null); setErrorMsg(null); } }} error={errorMsg}>
        <div className="surface p-6 space-y-4"><h3 className="text-lg font-bold">Delete {deleteItemTarget.name}?</h3><p>This removes the activity from new bills for {activeProperty?.name}. Existing bills and history are retained. You can restore it from the deleted activities list.</p><div className="flex gap-2"><button className="secondary-button" disabled={itemBusy} onClick={() => { setDeleteItemTarget(null); setErrorMsg(null); }}>Cancel</button><button className="primary-button" disabled={itemBusy} onClick={handleDeleteItem}>{itemBusy ? 'Deleting…' : 'Delete activity'}</button></div></div>
      </Modal>}

      {/* MODAL: ADD / EDIT CATALOGUE ACTIVITY */}
      {showItemModal && (
        <Modal label={editingItem ? 'Edit activity' : 'Add activity'} busy={itemBusy || categoryBusy} onClose={closeItemEditor} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {editingItem ? 'Edit activity' : 'Add activity'} · {activeProperty?.name}
            </h3>
            <p className="text-sm text-slate-500">Create a separate activity for a promotional offer. Enter an item code or leave it blank to generate one automatically; delete the activity when the offer ends.</p>
            <form onSubmit={handleSaveItem} className="space-y-3 text-sm">
              <fieldset disabled={itemBusy} className="space-y-3">
              <div className="activity-identity-fields grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="activity-code" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Item Code {editingItem ? '(read only)' : '(optional)'}
                  </label>
                  <input
                    id="activity-code"
                    type="text"
                    readOnly={Boolean(editingItem)}
                    maxLength={50}
                    value={itemForm.code}
                    onChange={event => setItemForm(form => ({ ...form, code: event.target.value }))}
                    placeholder="Leave blank to generate, e.g. DIV-001"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="adminview-field-15" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Category *
                  </label>
                  <select id="adminview-field-15"
                    value={itemForm.categoryId}
                    required
                    disabled={categoryBusy}
                    onChange={(e) => {
                      const categoryId = e.target.value;
                      const isCertification = /^certifications?$/i.test(categories.find(category => category.id === categoryId)?.name.trim() || '');
                      setItemForm({ ...itemForm, categoryId, ...(!editingItem && !noCommissions && isCertification ? { poolType: 'CERTIFICATION_POOL' as const } : {}) });
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  >
                    {!categories.length && <option value="">Add a category first</option>}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="text-button mt-2" onClick={() => setShowCategoryInput(value => !value)}>Add a category</button>
                  {(showCategoryInput || !categories.length) && <div className="category-create"><label htmlFor="new-category-name">New category name</label><input id="new-category-name" maxLength={80} value={newCategoryName} disabled={categoryBusy} placeholder="e.g. Dives" onChange={event => setNewCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleCreateCategory(); } }} /><button type="button" className="secondary-button" disabled={categoryBusy || !newCategoryName.trim()} onClick={handleCreateCategory}>{categoryBusy ? 'Creating…' : 'Create category'}</button></div>}

                </div>
              </div>

              <div>
                <label htmlFor="adminview-field-16" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Item Name *
                </label>
                <input id="adminview-field-16"
                  type="text"
                  required
                  minLength={2}
                  maxLength={200}
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Wreck Dive Special"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div className="commission-free-option">
                <label><input type="checkbox" checked={noCommissions}
                  disabled={Boolean(editingItem?.hasBillHistory && editingItem.poolType !== 'NONE')}
                  onChange={event => {
                    const checked = event.target.checked;
                    if (checked) {
                      previousCommissionSettings.current = { poolType: itemForm.poolType, poolContribution: itemForm.poolContribution, includesComplimentaryMedia: itemForm.includesComplimentaryMedia, selections: commissionSelections };
                      setItemForm(form => ({ ...form, poolType: 'NONE', poolContribution: 0, includesComplimentaryMedia: false }));
                      setCommissionSelections(rows => rows.map(row => ({ ...row, enabled: false })));
                    } else if (previousCommissionSettings.current) {
                      const previous = previousCommissionSettings.current;
                      setItemForm(form => ({ ...form, poolType: previous.poolType, poolContribution: previous.poolContribution, includesComplimentaryMedia: previous.includesComplimentaryMedia }));
                      setCommissionSelections(previous.selections);
                    }
                    setNoCommissions(checked);
                  }} /><span><strong>{storeAttendantPool ? 'No additional commissions for this activity' : 'No commissions for this activity'}</strong><small>{storeAttendantPool ? 'The automatic 5% Store attendant Retail pool still applies.' : 'No pool contribution, employee payments or automatically added Photo.'}</small></span></label>
                {editingItem?.hasBillHistory && editingItem.poolType !== 'NONE' && <p>Pool rules are protected on this billed service. Create a new activity to change them.</p>}
              </div>

              <div className={noCommissions ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label htmlFor="adminview-field-17" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Price ({activeProperty?.currencySymbol || '$'}) *
                  </label>
                  <input id="adminview-field-17"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                  />
                </div>
                <div hidden={noCommissions}>
                  <label htmlFor="adminview-field-18" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Pool Type
                  </label>
                  <select id="adminview-field-18"
                    disabled={editingItem?.hasBillHistory || noCommissions}
                    value={itemForm.poolType}
                    onChange={(e) => setItemForm({ ...itemForm, poolType: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  >
                    <option value="DIVE_POOL">Dive Pool</option>
                    <option value="COURSE_POOL">Course Pool</option>
                    <option value="CERTIFICATION_POOL">Certifications Pool (No Staff Commission)</option>
                    <option value="NONE">None (No Pool Share)</option>
                  </select>
                </div>
              </div>

              {noCommissions ? <p className="commission-free-notice">{storeAttendantPool ? 'The 5% Store attendant pool applies. No additional commissions are configured.' : 'This service earns no commissions. You can still set its guest price above.'}</p> : <>
              {itemForm.poolType === 'CERTIFICATION_POOL' && <p className="text-sm text-slate-500">Certifications pool contributions are tracked in reports and are not paid to staff or included in the base-leader override. Personal commission settings below are separate.</p>}

              <div><label htmlFor="activity-pool-contribution" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">{itemForm.poolType === 'COURSE_POOL' || itemForm.poolType === 'DIVE_POOL' ? 'Pool commission rate (%)' : `Pool contribution (${activeProperty?.currencySymbol || '$'})`}<span className="required-mark" aria-hidden="true">*</span></label><input id="activity-pool-contribution" type="number" min="0" max={itemForm.poolType === 'COURSE_POOL' || itemForm.poolType === 'DIVE_POOL' ? 100 : undefined} step="0.01" required disabled={editingItem?.hasBillHistory} value={itemForm.poolContribution} onChange={event => setItemForm({ ...itemForm, poolContribution: Number(event.target.value) })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />{editingItem?.hasBillHistory && <p className="text-xs text-slate-500 mt-1">Pool rules are fixed for activities used on saved bills. Create a new activity to use different rules.</p>}</div>

              {(itemForm.poolType === 'COURSE_POOL' || itemForm.poolType === 'DIVE_POOL') && <p className="text-xs text-slate-500">Calculated from the service total after discounts, before tax and service charge. A 10% rate on a $200 service with a 25% discount contributes $15 to the pool.</p>}

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <label className="flex items-start gap-2"><input type="checkbox" checked={itemForm.includesComplimentaryMedia} onChange={event => setItemForm({ ...itemForm, includesComplimentaryMedia: event.target.checked })} />
                  <span className="font-semibold">Include Photo ({photoPriceLabel})</span>
                </label>
                <p className="text-xs text-slate-500">Adds a separate Photo line at {photoPriceLabel} per unit on top of the activity price. Each selected Photo staff member on that line earns {photoCommissionLabel} per unit. Separate photo/video rates are paused. Changes apply to new bills.</p>
              </div>

              </>}
              {(!noCommissions || storeAttendantPool) && <PersonalCommissionEditor {...photoSettings} value={commissionSelections} onChange={setCommissionSelections}
                storeAttendantPool={storeAttendantPool} onlyStorePool={noCommissions} combinedMedia={!noCommissions && itemForm.includesComplimentaryMedia} currencySymbol={activeProperty?.currencySymbol || '$'} showPreview={false} />}
              <CommissionCalculatorPreview {...photoSettings} price={itemForm.price} poolType={noCommissions ? 'NONE' : itemForm.poolType} poolRate={noCommissions ? 0 : itemForm.poolContribution}
                storeAttendantPool={storeAttendantPool}
                selections={noCommissions ? commissionSelections.map(row => ({ ...row, enabled: false })) : commissionSelections}
                combinedMedia={!noCommissions && itemForm.includesComplimentaryMedia} currencySymbol={activeProperty?.currencySymbol || '$'} />

              <div className="dialog-actions flex">
                <button
                  type="button"
                  onClick={closeItemEditor}
                  disabled={itemBusy || categoryBusy}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!itemForm.categoryId || categoryBusy || itemBusy}
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {itemBusy ? 'Saving…' : editingItem ? 'Save changes' : 'Add activity'}
                </button>
              </div>
              </fieldset>
            </form>
          </div>
        </Modal>
      )}
      {bulkReview && <BulkMediaReview {...photoSettings} currencySymbol={activeProperty?.currencySymbol} review={bulkReview} busy={bulkBusy} error={bulkError}
        onClose={() => { if (!bulkBusy) { setBulkReview(null); setBulkError(null); } }} onApply={applyBulkMedia}
        onRefresh={() => reviewBulkMedia(bulkReview.includesComplimentaryMedia, bulkReview.items.map(item => item.id))} />}
    </>
  );
}
