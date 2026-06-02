import { computed, Signal, signal, WritableSignal } from '@angular/core';

export interface HasTitle {
  title: string;
}

export interface SearchFilterResult<T> {
  searchQuery: WritableSignal<string>;
  filteredItems: Signal<readonly T[] | T[]>;
}

export const createSearchFilter = <T extends HasTitle>(
  allItems: Signal<readonly T[] | T[]>,
): SearchFilterResult<T> => {
  const searchQuery = signal<string>('');
  const filteredItems = computed(() => {
    const q = searchQuery().toLowerCase().trim();
    const items = allItems();
    if (!q) return items;
    return items.filter((item) => item.title.toLowerCase().includes(q));
  });

  return {
    searchQuery,
    filteredItems,
  };
};
