import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { BoardTableHeaderComponent } from './board-table-header.component';
import { TableCol } from '../boards.util';

describe('BoardTableHeaderComponent', () => {
  let fixture: ComponentFixture<BoardTableHeaderComponent>;
  let cmp: BoardTableHeaderComponent;
  let changed: TableCol[][];
  let drafts: (TableCol[] | null)[];
  const cols: TableCol[] = [
    { id: 'title', width: 0 },
    { id: 'project', width: 160 },
    { id: 'tags', width: 200 },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardTableHeaderComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardTableHeaderComponent);
    cmp = fixture.componentInstance;
    fixture.componentRef.setInput('cols', cols);
    changed = [];
    drafts = [];
    cmp.changed.subscribe((c) => changed.push(c));
    cmp.draft.subscribe((c) => drafts.push(c));
    fixture.detectChanges();
  });

  it('hides a shown column and appends a hidden one with its default width', () => {
    cmp.toggleCol('project');
    cmp.toggleCol('estimate');
    expect(changed).toEqual([
      [cols[0], cols[2]],
      [...cols, { id: 'estimate', width: 90 }],
    ]);
  });

  it('reorders the columns after the title', () => {
    cmp.drop({ previousIndex: 1, currentIndex: 0 } as CdkDragDrop<unknown>);
    expect(changed).toEqual([[cols[0], cols[2], cols[1]]]);
  });

  it('drafts widths while dragging a divider and stores them once on release', () => {
    const handle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-col="tags"] .resize-handle',
    )!;
    handle.setPointerCapture = () => undefined;
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 500, bubbles: true }),
    );
    // The columns sit at the row's end: dragging the start edge left widens.
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 470 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 450 }));
    expect(changed).toEqual([]);
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 450 }));
    expect(drafts.at(-2)).toEqual([cols[0], cols[1], { id: 'tags', width: 250 }]);
    expect(drafts.at(-1)).toBeNull();
    expect(changed).toEqual([[cols[0], cols[1], { id: 'tags', width: 250 }]]);
  });

  it('stores nothing for a click on a divider without a drag', () => {
    const handle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-col="tags"] .resize-handle',
    )!;
    handle.setPointerCapture = () => undefined;
    handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 500 }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 500 }));
    expect(changed).toEqual([]);
  });

  it('sorts by a column on a click of its name, but not after dragging it', () => {
    const sorted: string[] = [];
    cmp.sortBy.subscribe((id) => sorted.push(id));
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-col="tags"] .sort-btn')!.click();
    el.querySelector<HTMLButtonElement>('.title-name .sort-btn')!.click();
    cmp.isDragged = true;
    cmp.onNameClick('tags');
    expect(sorted).toEqual(['tags', 'title']);
    // The project has no sort: a plain name.
    expect(el.querySelector('[data-col="project"] .sort-btn')).toBeNull();
  });

  it('marks the sorted column with its direction', () => {
    fixture.componentRef.setInput('sort', { key: 'tag', dir: 'desc' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-col="tags"]')!.getAttribute('aria-sort')).toBe(
      'descending',
    );
    expect(el.querySelector('[data-col="tags"] .sort-ico')!.textContent).toBe(
      'arrow_downward',
    );
  });

  it('opens the column picker on a right-click of the header', () => {
    const el = fixture.nativeElement as HTMLElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(el.querySelectorAll('.picker input[type="checkbox"]').length).toBe(7);
  });
});
