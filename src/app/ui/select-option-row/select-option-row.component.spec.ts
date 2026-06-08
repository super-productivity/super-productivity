import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenuItem, MatMenuModule } from '@angular/material/menu';

import { SelectOptionRowComponent } from './select-option-row.component';

@Component({
  imports: [MatMenuModule, SelectOptionRowComponent],
  template: `
    <button
      #emojiItem="matMenuItem"
      mat-menu-item
    >
      <select-option-row
        title="Emoji Project"
        icon="🎨"
        defaultIcon="folder"
      ></select-option-row>
    </button>
  `,
})
class SelectOptionRowMenuHostComponent {
  @ViewChild('emojiItem') emojiItem?: MatMenuItem;
}

describe('SelectOptionRowComponent', () => {
  let fixture: ComponentFixture<SelectOptionRowMenuHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectOptionRowMenuHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectOptionRowMenuHostComponent);
    fixture.detectChanges();
  });

  it('keeps emoji icons out of Angular Material menu typeahead labels', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.textContent).toContain('🎨');
    expect(fixture.componentInstance.emojiItem?.getLabel()).toBe('Emoji Project');
  });
});
