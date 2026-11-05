import { formatMoney, formatUnitPrice } from '../../utils/format';

import { Search, Plus, Receipt, Package } from 'lucide-react';
import type { BillModel } from './useBillController';

export function ActivityCatalogue({ model }: { model: BillModel }) {
  const {
    canManage, categories, compactBilling, currencySymbol, filteredItems,
    filteredPackages, handleAddItem, handleAddPackage, items,
    onSetup, packages, photoRates, searchQuery,
    selectedCategory, setSearchQuery, setSelectedCategory, setupLoading,
  } = model;
  return (
    <div id="bill-activities" className="xl:col-span-5 space-y-4 bill-activities">
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 catalogue-panel">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {compactBilling ? 'Activities' : '1. Choose activities'}
          </h2>
          <span className="text-sm text-slate-400">
            {selectedCategory === 'PACKAGES' ? `${filteredPackages.length} packages available` : `${filteredItems.length} items available`}
          </span>
        </div>

        {/* Search Box */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search catalogue"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search dive, course, or item..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        {/* Category Chips */}
        <div className={compactBilling ? "bill-category-list flex flex-wrap gap-1.5" : "flex flex-wrap gap-1.5"}>
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${selectedCategory === 'ALL'
                ? 'bg-sky-500 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${selectedCategory === c.id
                  ? 'bg-sky-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
            >
              {c.name}
            </button>
          ))}
          {packages.length > 0 && (
            <button
              onClick={() => setSelectedCategory('PACKAGES')}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${selectedCategory === 'PACKAGES'
                  ? 'bg-sky-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Dive Packages ({packages.length})</span>
            </button>
          )}
        </div>

        {selectedCategory === 'PACKAGES' ? (
          <div className="bill-catalogue-items space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {filteredPackages.length === 0 ? (
              <div className="empty-state">
                <Package size={28} />
                <h3>No matching dive packages</h3>
                <p>Try clearing your search or create new packages in Administration → Dive Packages.</p>
              </div>
            ) : (
              filteredPackages.map((pkg) => {
                if (compactBilling) return <button type="button" key={pkg.id} aria-label={`Add ${pkg.name} to bill`} className="catalogue-item p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 hover:border-sky-400 dark:hover:border-sky-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-sky-50/40 dark:hover:bg-sky-950/30 transition w-full text-left" onClick={() => handleAddPackage(pkg)}><span className="catalogue-item-title text-sm font-bold text-slate-900 dark:text-white">{pkg.name}</span></button>;
                const totalStandard = pkg.items.reduce((sum, pi) => {
                  const it = items.find(i => i.id === pi.itemId) || pi.item;
                  return sum + (it?.price || 0) * pi.quantity;
                }, 0);

                return (
                  <div
                    key={pkg.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/40 hover:border-sky-400 dark:hover:border-sky-500 transition space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300">
                          {pkg.code}
                        </span>
                        <h4 className="font-bold text-slate-900 dark:text-white mt-1 text-sm">
                          {pkg.name}
                        </h4>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold text-sky-600 dark:text-sky-400 font-mono">
                          {formatMoney(totalStandard, currencySymbol)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          +tax & SC at checkout
                        </div>
                      </div>
                    </div>

                    {pkg.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {pkg.description}
                      </p>
                    )}

                    <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 bg-white dark:bg-slate-900/60 p-2 rounded-lg border border-slate-200/60 dark:border-slate-800">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        Included in package:
                      </div>
                      {pkg.items.map((pi, idx) => {
                        const it = items.find(i => i.id === pi.itemId) || pi.item;
                        return (
                          <div key={idx} className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
                            <span><strong className="text-sky-600 dark:text-sky-400">{pi.quantity}×</strong> {it?.name || 'Catalogue item'}</span>
                            <span className="font-mono text-slate-400">{formatMoney((it?.price || 0) * pi.quantity, currencySymbol)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between pt-1 text-xs">
                      <div>
                        <span className="text-slate-400 text-xs">Total of included items</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddPackage(pkg)}
                        className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Package to Bill</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <>
            {setupLoading ? <div className="empty-state" role="status"><p>Loading your catalogue…</p></div> : filteredItems.length === 0 && <div className="empty-state"><Receipt size={28} /><h3>{items.length ? 'No matching activities' : 'Your catalogue is empty'}</h3><p>{items.length ? 'Try another search or category.' : canManage ? 'Add your activities and prices to make this property ready for billing.' : 'Ask your property manager to add activities and prices in Administration → Catalogue.'}</p>{!items.length && canManage && <button className="primary-button" onClick={onSetup}>Set up catalogue</button>}{items.length > 0 && <button className="text-button" onClick={() => { setSearchQuery(''); setSelectedCategory('ALL'); }}>Clear search & filters</button>}</div>}
            {/* Item List */}
            <div className="bill-catalogue-items space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {filteredItems.map((item) => {
                const hasPersonalRoles = item.includesComplimentaryMedia || Boolean(item.personalRoles && item.personalRoles.trim().length > 0);
                return (
                  <button
                    type="button"
                    aria-label={`Add ${item.name} to bill`}
                    key={item.id}
                    onClick={() => handleAddItem(item)}
                    className="catalogue-item p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 hover:border-sky-400 dark:hover:border-sky-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-sky-50/40 dark:hover:bg-sky-950/30 transition cursor-pointer flex items-center justify-between group w-full text-left"
                  >
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white catalogue-item-title group-hover:text-sky-600 dark:group-hover:text-sky-400 transition">
                        {item.name}
                      </div>
                      {!compactBilling && <div className="catalogue-item-meta">
                        <span className="font-mono text-xs text-slate-400 font-semibold">
                          {item.code}
                        </span>
                        {hasPersonalRoles && (
                          <span className="catalogue-tag px-1.5 py-0.2 rounded text-xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                            {item.includesComplimentaryMedia ? `Adds Photo ${formatUnitPrice(photoRates.price ?? 41.975, currencySymbol)} · team ${formatMoney(photoRates.commission ?? 4.5, currencySymbol)}` : `Commission: ${item.personalRoles}`}
                          </span>
                        )}
                        {item.poolType !== 'NONE' && (
                          <span className="catalogue-tag px-1.5 py-0.2 rounded text-xs font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                            {item.poolType === 'COURSE_POOL' ? `Course Pool ${item.poolContribution}%` : item.poolType === 'CERTIFICATION_POOL' ? 'Certifications Pool' : `Dive Pool ${item.poolContribution}%`}
                          </span>
                        )}
                      </div>}

                    </div>

                    {!compactBilling && <div className="catalogue-item-price text-right flex items-center space-x-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {formatMoney(item.price, currencySymbol)}
                      </span>
                      <div className="w-6 h-6 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                    </div>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
