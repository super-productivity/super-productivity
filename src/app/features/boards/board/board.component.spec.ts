import { NO_ERRORS_SCHEMA, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BoardComponent } from './board.component';
import { BoardPanelComponent } from '../board-panel/board-panel.component';
import { BoardCfg } from '../boards.model';
import { DEFAULT_BOARDS, DEFAULT_PANEL_CFG } from '../boards.const';
import { BoardsService } from '../boards.service';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { addTag } from '../../tag/store/tag.actions';
import { IMPORTANT_TAG, URGENT_TAG } from '../../tag/tag.const';
import { Tag } from '../../tag/tag.model';

describe('BoardComponent', () => {
  let fixture: ComponentFixture<BoardComponent>;
  let dispatch: jasmine.Spy;
  let tagIds: WritableSignal<ReadonlySet<string>>;

  // One `addTag` per tag; nothing else is dispatched.
  const addedTags = (): Tag[] =>
    dispatch.calls.allArgs().map(([action]) => {
      expect(action.type).toBe(addTag.type);
      return action.tag;
    });

  const eisenhower = DEFAULT_BOARDS.find((board) => board.id === 'EISENHOWER_MATRIX')!;

  const render = async (board: BoardCfg, existing: string[]): Promise<HTMLElement> => {
    dispatch = jasmine.createSpy('dispatch');
    tagIds = signal(new Set(existing));
    await TestBed.configureTestingModule({
      imports: [BoardComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: Store, useValue: { dispatch } },
        { provide: BoardsService, useValue: { editBoard: jasmine.createSpy() } },
        { provide: ViewCriteriaContextService, useValue: { tagIdSet: tagIds } },
      ],
    })
      // The columns are covered by the board panel's specs.
      .overrideComponent(BoardComponent, {
        remove: { imports: [BoardPanelComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      F: { BOARDS: { V: { MISSING_TAGS_MSG: 'Missing tags: {{tags}}' } } },
    });
    translate.use('en');

    fixture = TestBed.createComponent(BoardComponent);
    fixture.componentRef.setInput('boardCfg', board);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows the columns together with a callout naming the missing tags', async () => {
    const el = await render(eisenhower, []);

    expect(el.querySelectorAll('board-panel').length).toBe(4);
    expect(el.style.getPropertyValue('--cols')).toBe('2');
    const callout = el.querySelector('.callout')!;
    expect(callout.textContent).toContain('Missing tags: important, urgent');
    // Above the columns.
    expect(el.firstElementChild).toBe(callout);
  });

  it('creates each missing tag with its fixed id, and drops the callout once they exist', async () => {
    const el = await render(eisenhower, []);

    el.querySelector<HTMLButtonElement>('.callout button')!.click();
    expect(addedTags().map((tag) => [tag.id, tag.title])).toEqual([
      [IMPORTANT_TAG.id, IMPORTANT_TAG.title],
      [URGENT_TAG.id, URGENT_TAG.title],
    ]);

    // The store reports them (here, or synced from another device).
    tagIds.set(new Set([IMPORTANT_TAG.id, URGENT_TAG.id]));
    fixture.detectChanges();
    // It collapses on its way out (a no-op animation here).
    await fixture.whenStable();
    expect(el.querySelector('.callout')).toBeNull();
    expect(el.querySelectorAll('board-panel').length).toBe(4);
  });

  it('names an unknown tag by its id and creates it with the fallback title', async () => {
    const el = await render(
      {
        id: 'b',
        title: 'B',
        cols: 1,
        panels: [{ ...DEFAULT_PANEL_CFG, id: 'p', includedTagIds: ['gone'] }],
      },
      [],
    );

    expect(el.querySelector('.callout')!.textContent).toContain('Missing tags: gone');
    el.querySelector<HTMLButtonElement>('.callout button')!.click();
    expect(addedTags().map((tag) => [tag.id, tag.title])).toEqual([
      ['gone', 'some-tag-gone'],
    ]);
  });

  it('has no callout when every tag exists', async () => {
    const el = await render(eisenhower, [IMPORTANT_TAG.id, URGENT_TAG.id]);

    expect(el.querySelector('.callout')).toBeNull();
    expect(el.querySelectorAll('board-panel').length).toBe(4);
  });
});
