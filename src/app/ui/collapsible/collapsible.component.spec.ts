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
    <collapsible
      [title]="'Non-Group'"
      [isGroup]="false"
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
    CollapsibleComponent['_groupCollapsibles'].clear();
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
    const groupCollapsibles = collapsibleInstances.slice(0, 2);

    header.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(groupCollapsibles.every((c) => c.isExpanded)).toBe(true);

    header.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(groupCollapsibles.every((c) => c.isExpanded)).toBe(false);
  });

  it('should toggle the group with Enter and Space', () => {
    const header = headerElements[0];
    const collapsible = collapsibleInstances[0];

    expect(collapsible.isExpanded).toBe(false);

    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(collapsible.isExpanded).toBe(true);

    header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();

    expect(collapsible.isExpanded).toBe(false);
  });

  it('should not toggle a non-group collapsible with Arrow keys', () => {
    const nonGroupHeader = headerElements[2];
    const nonGroupCollapsible = collapsibleInstances[2];

    expect(nonGroupCollapsible.isExpanded).toBe(false);

    nonGroupHeader.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();

    expect(nonGroupCollapsible.isExpanded).toBe(false);
  });

  it('should not affect group collapsibles when Shift+Arrow on a non-group', () => {
    const nonGroupHeader = headerElements[2];
    const groupCollapsibles = collapsibleInstances.slice(0, 2);

    // First expand all groups
    headerElements[0].dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(groupCollapsibles.every((c) => c.isExpanded)).toBe(true);

    // Now Shift+Arrow on non-group should not affect groups
    nonGroupHeader.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(groupCollapsibles.every((c) => c.isExpanded)).toBe(true);
  });
});
