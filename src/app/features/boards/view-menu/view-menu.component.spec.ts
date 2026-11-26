import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { BoardCfg } from '../boards.model';
import { BoardsService } from '../boards.service';
import { ViewMenuComponent } from './view-menu.component';

const kanban: BoardCfg = { id: 'kanban', title: 'Kanban', cols: 3, panels: [] };

@Component({
  standalone: true,
  imports: [ViewMenuComponent, MatMenuTrigger],
  template: `
    <button [matMenuTriggerFor]="viewMenu.menu()">open</button>
    <view-menu
      #viewMenu
      [board]="board"
    ></view-menu>
  `,
})
class HostComponent {
  readonly trigger = viewChild.required(MatMenuTrigger);
  board = kanban;
}

describe('ViewMenuComponent', () => {
  let service: jasmine.SpyObj<BoardsService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj<BoardsService>('BoardsService', [
      'editBoard',
      'duplicateBoard',
      'removeBoard',
    ]);
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [{ provide: BoardsService, useValue: service }],
    }).compileComponents();
  });

  const openItems = (): HTMLButtonElement[] => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const trigger = fixture.componentInstance.trigger();
    trigger.openMenu();
    fixture.detectChanges();
    const panel = document.getElementById((trigger.menu as MatMenu).panelId)!;
    return Array.from(panel.querySelectorAll('button'));
  };

  // The layout is the title bar's List/Board button (wide screens) or the
  // editor's: phones show every view as a list.
  it('offers Edit, Duplicate and Delete', () => {
    expect(openItems().map((item) => item.textContent)).toEqual([
      jasmine.stringContaining(T.G.EDIT),
      jasmine.stringContaining(T.G.DUPLICATE),
      jasmine.stringContaining(T.G.DELETE),
    ]);
  });

  it('runs each item through the service', () => {
    // A click closes the menu, so each item gets a freshly opened one.
    [0, 1, 2].forEach((i) => openItems()[i].click());
    expect(service.editBoard).toHaveBeenCalledOnceWith(kanban);
    expect(service.duplicateBoard).toHaveBeenCalledOnceWith(kanban);
    expect(service.removeBoard).toHaveBeenCalledOnceWith(kanban);
  });
});
