import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { BoardCfg } from '../boards.model';
import { BoardsService } from '../boards.service';
import { ViewMenuComponent } from './view-menu.component';

describe('ViewMenuComponent', () => {
  const list: BoardCfg = { id: 'list', title: 'List', cols: 1, panels: [] };
  const kanban: BoardCfg = { id: 'kanban', title: 'Kanban', cols: 3, panels: [] };
  let setViewLayout: jasmine.Spy;

  const render = (board: BoardCfg, withLayoutSwitch?: boolean): HTMLElement => {
    const fixture = TestBed.createComponent(ViewMenuComponent);
    fixture.componentRef.setInput('board', board);
    if (withLayoutSwitch !== undefined) {
      fixture.componentRef.setInput('withLayoutSwitch', withLayoutSwitch);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const layoutItem = (host: HTMLElement): HTMLButtonElement | null =>
    host.querySelector('.view-layout-item');

  beforeEach(async () => {
    setViewLayout = jasmine.createSpy('setViewLayout');
    await TestBed.configureTestingModule({
      imports: [ViewMenuComponent, TranslateModule.forRoot()],
      providers: [{ provide: BoardsService, useValue: { setViewLayout } }],
    }).compileComponents();
  });

  it('has no List/Board item by default (the side menu, the title bar on wide screens)', () => {
    expect(layoutItem(render(list))).toBeNull();
  });

  it('offers the other mode first, with the title bar button’s icon and label', () => {
    const onList = render(list, true);
    expect(onList.querySelector('button')).toBe(layoutItem(onList));
    expect(layoutItem(onList)?.textContent).toContain('view_kanban');
    expect(layoutItem(onList)?.textContent).toContain(T.F.BOARDS.V.SHOW_AS_BOARD);

    const onBoard = layoutItem(render(kanban, true));
    expect(onBoard?.textContent).toContain('view_list');
    expect(onBoard?.textContent).toContain(T.F.BOARDS.V.SHOW_AS_LIST);
  });

  it('switches the view to that mode', () => {
    layoutItem(render(list, true))?.click();
    expect(setViewLayout).toHaveBeenCalledOnceWith(list, 'board');
    setViewLayout.calls.reset();
    layoutItem(render(kanban, true))?.click();
    expect(setViewLayout).toHaveBeenCalledOnceWith(kanban, 'list');
  });
});
