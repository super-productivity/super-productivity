import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { BoardCfg } from '../../../features/boards/boards.model';
import { BoardsService } from '../../../features/boards/boards.service';
import { BoardsActions } from '../../../features/boards/store/boards.actions';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { NavItem, NavViewGroupItem } from '../magic-side-nav.model';
import { NavViewGroupComponent } from './nav-view-group.component';

describe('NavViewGroupComponent', () => {
  let fixture: ComponentFixture<NavViewGroupComponent>;
  let component: NavViewGroupComponent;
  let dispatch: jasmine.Spy;
  let disableFeature: jasmine.Spy;

  const board = (id: string, panelCount: number): BoardCfg => ({
    id,
    title: id,
    cols: panelCount,
    panels: Array.from({ length: panelCount }, (_, i) => ({ id: `${id}-${i}` }) as any),
  });

  const item: NavViewGroupItem = {
    type: 'viewGroup',
    id: 'views',
    label: 'Views',
    icon: 'expand_more',
    action: () => undefined,
  };

  beforeEach(async () => {
    dispatch = jasmine.createSpy('dispatch');
    disableFeature = jasmine.createSpy('disableFeature');
    await TestBed.configureTestingModule({
      imports: [NavViewGroupComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: Store, useValue: { dispatch } },
        {
          provide: BoardsService,
          useValue: { boards: signal([board('a', 1), board('b', 3)]) },
        },
        { provide: MagicNavConfigService, useValue: { disableFeature } },
      ],
    })
      // The rows' nav-items need the router and theme; the logic under test
      // doesn't render them.
      .overrideTemplate(NavViewGroupComponent, '')
      .compileComponents();

    fixture = TestBed.createComponent(NavViewGroupComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
  });

  it('links each view to its route, with a list or board icon', () => {
    expect(component.rows().map((row) => [row.route, row.icon])).toEqual([
      ['/boards/a', 'filter_list'],
      ['/boards/b', 'view_kanban'],
    ]);
  });

  it('reorders views with sortBoards', () => {
    component.drop({ previousIndex: 0, currentIndex: 1 } as CdkDragDrop<BoardCfg[]>);
    expect(dispatch).toHaveBeenCalledOnceWith(
      BoardsActions.sortBoards({ ids: ['b', 'a'] }),
    );
  });

  it('does not dispatch when a view is dropped in place', () => {
    component.drop({ previousIndex: 1, currentIndex: 1 } as CdkDragDrop<BoardCfg[]>);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('emits the header for toggling and a route item for a view click', () => {
    const clicks: NavItem[] = [];
    component.itemClick.subscribe((clicked) => clicks.push(clicked));

    component.onHeaderClick();
    component.onRowClick(board('a', 1));

    expect(clicks[0].type).toBe('viewGroup');
    expect(clicks[1]).toEqual(
      jasmine.objectContaining({ type: 'route', route: '/boards/a' }),
    );
  });

  it('disables the views feature from the section menu', () => {
    component.disableFeature();
    expect(disableFeature).toHaveBeenCalledOnceWith('isBoardsEnabled', 'Views');
  });
});
