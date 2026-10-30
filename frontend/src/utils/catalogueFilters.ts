import type { Item } from '../types';
export type CatalogueFilters = { query: string; categoryId: string; poolType: string; media: 'all' | 'included' | 'excluded' };
export const emptyCatalogueFilters: CatalogueFilters = { query: '', categoryId: '', poolType: '', media: 'all' };
export function filterCatalogue(items: Item[], filters: CatalogueFilters, showArchived: boolean): Item[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter(item => (showArchived || item.isActive) &&
    (!query || `${item.code} ${item.name} ${item.category?.name || ''}`.toLowerCase().includes(query)) &&
    (!filters.categoryId || item.categoryId === filters.categoryId) &&
    (!filters.poolType || item.poolType === filters.poolType) &&
    (filters.media === 'all' || Boolean(item.includesComplimentaryMedia) === (filters.media === 'included')));
}
