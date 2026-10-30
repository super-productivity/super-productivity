import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatOption } from '@angular/material/core';
import { MatMenuItem, MatMenuModule } from '@angular/material/menu';

import { SelectOptionRowComponent } from './select-option-row.component';

@Component({
  imports: [MatMenuModule, MatOption, SelectOptionRowComponent],
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
    <mat-option value="work">
      <select-option-row
        title="Work"
        defaultIcon="list_alt"
      ></select-option-row>
    </mat-option>
  `,
})
class SelectOptionRowHostComponent {
  @ViewChild('emojiItem') emojiItem?: MatMenuItem;
  @ViewChild(MatOption) option?: MatOption;
}

describe('SelectOptionRowComponent', () => {
  let fixture: ComponentFixture<SelectOptionRowHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectOptionRowHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectOptionRowHostComponent);
    fixture.detectChanges();
  });

  it('keeps emoji icons out of Angular Material menu typeahead labels', () => {
    const icon = fixture.nativeElement.querySelector('button mat-icon') as HTMLElement;

    expect(icon.getAttribute('fontIcon')).toBe('🎨');
    expect(fixture.componentInstance.emojiItem?.getLabel()).toBe('Emoji Project');
  });

  it('keeps icon names out of mat-option labels', () => {
    expect(fixture.componentInstance.option?.viewValue).toBe('Work');
  });
});
