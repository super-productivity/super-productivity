import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { BoardCfg } from '../boards.model';
import { BoardsService } from '../boards.service';
import { ViewMenuComponent } from './view-menu.component';

describe('ViewMenuComponent', () => {
  const kanban: BoardCfg = { id: 'kanban', title: 'Kanban', cols: 3, panels: [] };
  let editBoard: jasmine.Spy;

  beforeEach(async () => {
    editBoard = jasmine.createSpy('editBoard');
    await TestBed.configureTestingModule({
      imports: [ViewMenuComponent, TranslateModule.forRoot()],
      providers: [{ provide: BoardsService, useValue: { editBoard } }],
    }).compileComponents();
  });

  // The layout is the title bar's List/Board button (wide screens) or the
  // editor's: phones show every view as a list.
  it('offers Edit, Duplicate and Delete, and edits the view', () => {
    const fixture = TestBed.createComponent(ViewMenuComponent);
    fixture.componentRef.setInput('board', kanban);
    fixture.detectChanges();
    const items = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(items.map((item) => item.textContent)).toEqual([
      jasmine.stringContaining(T.G.EDIT),
      jasmine.stringContaining(T.G.DUPLICATE),
      jasmine.stringContaining(T.G.DELETE),
    ]);
    items[0].click();
    expect(editBoard).toHaveBeenCalledOnceWith(kanban);
  });
});
