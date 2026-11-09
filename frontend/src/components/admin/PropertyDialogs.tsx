import { pmsResortCodes } from '../../utils/pmsGuests';
import { Modal } from '../Modal';

import type { AdminModel } from './useAdminController';

export function PropertyDialogs({ model }: { model: AdminModel }) {
  const {
    closePropertyDelete, deletePropertyCode, deletePropertyTarget, editingProperty,
    errorMsg, handleDeleteProperty, handleSaveProperty, isGlobalAdmin,
    propForm, propertyDeleting, propertySaving, setDeletePropertyCode,
    setErrorMsg, setPropForm, setShowPropertyModal, showPropertyModal,
  } = model;
  return (
    <>
      {isGlobalAdmin && deletePropertyTarget && <Modal label={`Delete property ${deletePropertyTarget.name}`} onClose={closePropertyDelete} busy={propertyDeleting} error={errorMsg}>
        <form className="surface guard-dialog" onSubmit={handleDeleteProperty} aria-busy={propertyDeleting}>
          <h2>Delete {deletePropertyTarget.name}?</h2>
          <p id="delete-property-explanation">This removes the property from the workspace and revokes staff and manager access to it. Its bills, staff records, payroll and audit history will be retained.</p>
          <p>{deletePropertyTarget._count?.bills ?? 0} bills and {deletePropertyTarget._count?.staffMembers ?? 0} staff records will stay in history. User login accounts will remain.</p>
          <label htmlFor="delete-property-code">Type <strong>{deletePropertyTarget.code}</strong> to confirm.<span className="required-mark" aria-hidden="true">*</span></label>
          <input id="delete-property-code" className="field-input" autoComplete="off" spellCheck={false} aria-describedby="delete-property-explanation" required value={deletePropertyCode} onChange={e => setDeletePropertyCode(e.target.value)} disabled={propertyDeleting} />
          <div className="dialog-actions"><button type="button" className="secondary-button" disabled={propertyDeleting} onClick={closePropertyDelete}>Cancel</button><button type="submit" className="danger-button" disabled={propertyDeleting || deletePropertyCode.trim().toUpperCase() !== deletePropertyTarget.code}>{propertyDeleting ? 'Deleting…' : 'Delete property'}</button></div>
        </form>
      </Modal>}

      {/* MODAL: CREATE / EDIT PROPERTY */}
      {isGlobalAdmin && showPropertyModal && (
        <Modal label={editingProperty ? `Edit property ${editingProperty.name}` : 'Create property'} busy={propertySaving} onClose={() => { if (!propertySaving) { setShowPropertyModal(false); setErrorMsg(null); } } } error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {editingProperty ? 'Edit Dive Centre Property' : 'Create Dive Centre Property'}
            </h3>
            <form onSubmit={handleSaveProperty} className="space-y-3 text-sm" aria-busy={propertySaving}>
              <fieldset disabled={propertySaving} className="space-y-3">
                <div>
                  <label htmlFor="adminview-field-1" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Property Name *
                  </label>
                  <input id="adminview-field-1"
                    type="text"
                    required
                    value={propForm.name}
                    onChange={(e) => setPropForm({ ...propForm, name: e.target.value })}
                    placeholder="e.g. Sun Diving - Baa Atoll"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adminview-field-2" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Property Code {editingProperty ? '*' : '(optional)'}
                    </label>
                    <input id="adminview-field-2"
                      type="text"
                      required={Boolean(editingProperty)}
                      minLength={2}
                      maxLength={10}
                      value={propForm.code}
                      onChange={(e) => setPropForm({ ...propForm, code: e.target.value.toUpperCase() })}
                      placeholder="SUN-BAA"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                    />
                    <p className="text-xs text-slate-400 mt-1">{editingProperty ? 'Enter 2–10 characters. The code must be unique.' : 'Leave blank to generate from the name, or enter 2–10 characters.'}</p>
                  </div>
                  <div>
                    <label htmlFor="adminview-field-3" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Location (optional)
                    </label>
                    <input id="adminview-field-3"
                      type="text"
                      value={propForm.location}
                      onChange={(e) => setPropForm({ ...propForm, location: e.target.value })}
                      placeholder="e.g. Baa Atoll"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label>Currency<input className="field-input" required value={propForm.currency} onChange={e => setPropForm({ ...propForm, currency: e.target.value })} /></label>
                  <label>Currency symbol<input className="field-input" required value={propForm.currencySymbol} onChange={e => setPropForm({ ...propForm, currencySymbol: e.target.value })} /></label>
                </div>
                {editingProperty && <label className="flex items-center gap-2"><input type="checkbox" checked={propForm.isActive} onChange={e => setPropForm({ ...propForm, isActive: e.target.checked })} /> Active property</label>}
                <fieldset className="space-y-2"><legend>PMS resorts (optional)</legend><div className="flex flex-wrap gap-3">{pmsResortCodes.map(code => <label key={code} className="flex items-center gap-1"><input type="checkbox" checked={propForm.pmsPropertyCodes.includes(code)} onChange={e => setPropForm({ ...propForm, pmsPropertyCodes: e.target.checked ? [...propForm.pmsPropertyCodes, code] : propForm.pmsPropertyCodes.filter(value => value !== code) })} />{code}</label>)}</div></fieldset>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="adminview-field-4" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Tax (%)
                    <span className="required-mark" aria-hidden="true">*</span></label>
                    <input id="adminview-field-4"
                      type="number"
                      step="0.1"
                      required min="0" max="100"
                      value={propForm.taxRate}
                      onChange={(e) => setPropForm({ ...propForm, taxRate: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="adminview-field-5" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      SC (%)
                    <span className="required-mark" aria-hidden="true">*</span></label>
                    <input id="adminview-field-5"
                      type="number"
                      step="0.1"
                      required min="0" max="100"
                      value={propForm.serviceChargeRate}
                      onChange={(e) => setPropForm({ ...propForm, serviceChargeRate: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="adminview-field-6" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {editingProperty ? 'Next Check #' : 'Start Check #'}
                    <span className="required-mark" aria-hidden="true">*</span></label>
                    <input id="adminview-field-6"
                      type="number"
                      required min="1" step="1"
                      value={propForm.nextCheckNumber}
                      onChange={(e) => setPropForm({ ...propForm, nextCheckNumber: parseInt(e.target.value, 10) || 1001 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/60">
                  <div>
                    <label htmlFor="adminview-photo-price" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Photo Line Price ({propForm.currencySymbol || '$'})
                    <span className="required-mark" aria-hidden="true">*</span></label>
                    <input
                      id="adminview-photo-price"
                      type="number"
                      required
                      min="0"
                      step="0.001"
                      value={propForm.autoPhotoPrice}
                      onChange={(e) => setPropForm({ ...propForm, autoPhotoPrice: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                    <p className="text-xs text-slate-400 mt-1">Pre-tax/SC rate (default: $41.975). Tax & SC applied at checkout.</p>
                  </div>
                  <div>
                    <label htmlFor="adminview-photo-comm" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Photo Staff Commission ({propForm.currencySymbol || '$'})
                    <span className="required-mark" aria-hidden="true">*</span></label>
                    <input
                      id="adminview-photo-comm"
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={propForm.autoPhotoCommission}
                      onChange={(e) => setPropForm({ ...propForm, autoPhotoCommission: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                    <p className="text-xs text-slate-400 mt-1">Per-unit commission for each selected Photo staff member (default: $4.50).</p>
                  </div>
                </div>

              </fieldset>
              <div className="dialog-actions flex">
                <button
                  type="button"
                  disabled={propertySaving}
                  onClick={() => setShowPropertyModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={propertySaving}
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {propertySaving ? 'Saving…' : editingProperty ? 'Save Changes' : 'Save Property'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

    </>
  );
}
