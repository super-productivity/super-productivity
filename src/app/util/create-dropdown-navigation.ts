import { effect, ElementRef, signal, Signal, WritableSignal } from '@angular/core';

export interface DropdownNavigationResult {
  activeIndex: WritableSignal<number>;
  adjustActiveIndex: (direction: 'up' | 'down', event?: Event) => void;
  setActiveIndex: (index: number) => void;
  selectActive: (event: Event) => void;
  resetActive: (items: readonly any[], initialIndex?: number) => void;
}

export const createDropdownNavigation = <T extends { id: string }>(
  filteredItems: Signal<readonly T[] | T[]>,
  onSelect: (item: T) => void,
  getMenuTrigger?: () => { closeMenu: () => void } | undefined,
  getMenuItems?: () => readonly ElementRef[] | undefined,
): DropdownNavigationResult => {
  const activeIndex = signal<number>(0);
  let lastHighlightedId: string | null = null;
  let prevFiltered: readonly T[] = [];

  const scrollActiveItemIntoView = (index: number): void => {
    if (!getMenuItems) return;
    setTimeout(() => {
      const items = getMenuItems();
      const activeEl = items?.[index]?.nativeElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  };

  // Sync index on filter changes
  effect(
    () => {
      const filtered = filteredItems();
      if (filtered !== prevFiltered) {
        prevFiltered = filtered;
        const lastId = lastHighlightedId;
        if (filtered.length === 0) {
          activeIndex.set(0);
          return;
        }
        if (lastId) {
          const idx = filtered.findIndex((item) => item.id === lastId);
          if (idx >= 0) {
            activeIndex.set(idx);
            return;
          }
        }
        const newIdx = Math.max(0, Math.min(activeIndex(), filtered.length - 1));
        activeIndex.set(newIdx);
        lastHighlightedId = filtered[newIdx]?.id || null;
      }
    },
    { allowSignalWrites: true },
  );

  const setActiveIndex = (index: number): void => {
    const filtered = filteredItems();
    const clamped = Math.max(0, Math.min(index, filtered.length - 1));
    activeIndex.set(clamped);
    lastHighlightedId = filtered[clamped]?.id || null;
  };

  const adjustActiveIndex = (direction: 'up' | 'down', event?: Event): void => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const filtered = filteredItems();
    const len = filtered.length;
    if (len === 0) return;
    activeIndex.update((i) => {
      const next = direction === 'down' ? i + 1 : i - 1;
      const newIdx = (next + len) % len;
      lastHighlightedId = filtered[newIdx]?.id || null;
      scrollActiveItemIntoView(newIdx);
      return newIdx;
    });
  };

  const selectActive = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const activeItem = filteredItems()[activeIndex()];
    if (activeItem) {
      onSelect(activeItem);
      const trigger = getMenuTrigger ? getMenuTrigger() : undefined;
      if (trigger) {
        trigger.closeMenu();
      }
    }
  };

  const resetActive = (items: readonly T[], initialIndex = 0): void => {
    const clamped = Math.max(0, Math.min(initialIndex, items.length - 1));
    activeIndex.set(clamped);
    lastHighlightedId = items[clamped]?.id || null;
    prevFiltered = items;
    scrollActiveItemIntoView(clamped);
  };

  return {
    activeIndex,
    adjustActiveIndex,
    setActiveIndex,
    selectActive,
    resetActive,
  };
};
