import { createSearchFilter } from './create-search-filter';
import { signal } from '@angular/core';

interface TestItem {
  id: string;
  title: string;
}

describe('createSearchFilter', () => {
  it('should return all items when search query is empty', () => {
    const items = [
      { id: '1', title: 'Apple' },
      { id: '2', title: 'Banana' },
    ];
    const itemsSignal = signal<TestItem[]>(items);
    const searchFilter = createSearchFilter(itemsSignal);

    expect(searchFilter.filteredItems()).toEqual(items);
  });

  it('should filter items by title case-insensitively', () => {
    const items = [
      { id: '1', title: 'Apple' },
      { id: '2', title: 'Banana' },
      { id: '3', title: 'Pineapple' },
    ];
    const itemsSignal = signal<TestItem[]>(items);
    const searchFilter = createSearchFilter(itemsSignal);

    searchFilter.searchQuery.set('apple');
    expect(searchFilter.filteredItems()).toEqual([
      { id: '1', title: 'Apple' },
      { id: '3', title: 'Pineapple' },
    ]);
  });

  it('should trim search query', () => {
    const items = [
      { id: '1', title: 'Apple' },
      { id: '2', title: 'Banana' },
    ];
    const itemsSignal = signal<TestItem[]>(items);
    const searchFilter = createSearchFilter(itemsSignal);

    searchFilter.searchQuery.set('  apple  ');
    expect(searchFilter.filteredItems()).toEqual([{ id: '1', title: 'Apple' }]);
  });

  it('should return empty list if no items match', () => {
    const items = [
      { id: '1', title: 'Apple' },
      { id: '2', title: 'Banana' },
    ];
    const itemsSignal = signal<TestItem[]>(items);
    const searchFilter = createSearchFilter(itemsSignal);

    searchFilter.searchQuery.set('Orange');
    expect(searchFilter.filteredItems()).toEqual([]);
  });
});
