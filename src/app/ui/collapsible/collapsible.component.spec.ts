import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconModule } from '@angular/material/icon';
import { CollapsibleComponent } from './collapsible.component';

@Component({
  standalone: true,
  template: `
    <collapsible
      [title]="'Group One'"
      [isGroup]="true"
    ></collapsible>
    <collapsible
      [title]="'Group Two'"
      [isGroup]="true"
    ></collapsible>
  `,
  imports: [CollapsibleComponent],
})
class TestHostComponent {}

describe('CollapsibleComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let headerElements: HTMLElement[];
  let collapsibleInstances: CollapsibleComponent[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, MatIconModule, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    headerElements = Array.from(
      fixture.nativeElement.querySelectorAll('.collapsible-header'),
    );
    collapsibleInstances = fixture.debugElement
      .queryAll(By.directive(CollapsibleComponent))
      .map((de) => de.componentInstance as CollapsibleComponent);
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should toggle the current group with ArrowLeft and ArrowRight', () => {
    const header = headerElements[0];

    expect(collapsibleInstances[0].isExpanded).toBe(false);

    header.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();

    expect(collapsibleInstances[0].isExpanded).toBe(true);

    header.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    fixture.detectChanges();

    expect(collapsibleInstances[0].isExpanded).toBe(false);
  });

  it('should expand and collapse all groups with Shift+ArrowRight / Shift+ArrowLeft', () => {
    const header = headerElements[0];

    header.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(collapsibleInstances.every((c) => c.isExpanded)).toBe(true);

    header.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(collapsibleInstances.every((c) => c.isExpanded)).toBe(false);
  });
});
