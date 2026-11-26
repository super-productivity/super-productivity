import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
  MatDialogConfig,
  MatDialogRef,
} from '@angular/material/dialog';
import {
  createDialogDefaultOptions,
  DIALOG_AUTO_FOCUS_TYPING,
  getDefaultDialogAutoFocus,
} from './dialog-auto-focus';

@Component({
  selector: 'test-dialog-with-field',
  template: `
    <h2>Edit</h2>
    <input
      class="title-input"
      type="text"
    />
    <button class="ok-btn">OK</button>
  `,
})
class TestDialogWithFieldComponent {}

describe('dialog auto focus', () => {
  describe('getDefaultDialogAutoFocus', () => {
    it('focuses the dialog container on touch', () => {
      expect(getDefaultDialogAutoFocus(() => true)).toBe('dialog');
    });

    it('keeps Material’s first-tabbable default otherwise', () => {
      expect(getDefaultDialogAutoFocus(() => false)).toBe('first-tabbable');
    });
  });

  describe('createDialogDefaultOptions', () => {
    it('keeps every other Material default', () => {
      const { autoFocus, ...rest } = createDialogDefaultOptions(() => false);
      const { autoFocus: matAutoFocus, ...matRest } = new MatDialogConfig();
      expect(autoFocus).toBe(matAutoFocus);
      expect(rest).toEqual(matRest);
      expect(rest.role).toBe('dialog');
      expect(rest.restoreFocus).toBeTrue();
    });

    it('reads the input type each time the options are spread', () => {
      let isTouch = false;
      const options = createDialogDefaultOptions(() => isTouch);
      expect({ ...options }.autoFocus).toBe('first-tabbable');
      isTouch = true;
      expect({ ...options }.autoFocus).toBe('dialog');
    });
  });

  describe('with MatDialog', () => {
    let isTouch: boolean;
    let dialog: MatDialog;
    let trigger: HTMLButtonElement;
    let openRefs: MatDialogRef<unknown>[];

    const openAndWaitForFocus = async (
      config?: MatDialogConfig,
    ): Promise<MatDialogRef<TestDialogWithFieldComponent>> => {
      const ref = dialog.open(TestDialogWithFieldComponent, config);
      openRefs.push(ref);
      await ref.afterOpened().toPromise();
      // focus is applied in an afterNextRender hook
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
      return ref;
    };

    const containerOf = (ref: MatDialogRef<unknown>): HTMLElement =>
      document.getElementById(ref.id) as HTMLElement;

    beforeEach(() => {
      isTouch = false;
      openRefs = [];
      TestBed.configureTestingModule({
        providers: [
          {
            provide: MAT_DIALOG_DEFAULT_OPTIONS,
            useValue: createDialogDefaultOptions(() => isTouch),
          },
          { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ],
      });
      dialog = TestBed.inject(MatDialog);
      trigger = document.createElement('button');
      trigger.textContent = 'open';
      document.body.appendChild(trigger);
      trigger.focus();
    });

    afterEach(() => {
      openRefs.forEach((ref) => ref.close());
      trigger.remove();
    });

    it('focuses the first field when not on touch', async () => {
      const ref = await openAndWaitForFocus();
      expect(document.activeElement).toBe(
        containerOf(ref).querySelector('.title-input') as HTMLElement,
      );
    });

    it('focuses the dialog itself, not a field, on touch', async () => {
      isTouch = true;
      const ref = await openAndWaitForFocus();
      const container = containerOf(ref);
      expect(document.activeElement).toBe(container);
      expect(container.getAttribute('role')).toBe('dialog');
    });

    it('still focuses the first field on touch for an opted-in dialog', async () => {
      isTouch = true;
      const ref = await openAndWaitForFocus({ autoFocus: DIALOG_AUTO_FOCUS_TYPING });
      expect(document.activeElement).toBe(
        containerOf(ref).querySelector('.title-input') as HTMLElement,
      );
    });

    it('returns focus to the trigger on close on touch', async () => {
      isTouch = true;
      const ref = await openAndWaitForFocus();
      ref.close();
      await ref.afterClosed().toPromise();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
