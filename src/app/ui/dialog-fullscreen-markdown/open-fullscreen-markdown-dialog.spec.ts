import { MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { Location } from '@angular/common';
import { Subject } from 'rxjs';
import { openFullscreenMarkdownDialog } from './open-fullscreen-markdown-dialog';
import { DialogFullscreenMarkdownComponent } from './dialog-fullscreen-markdown.component';

describe('openFullscreenMarkdownDialog', () => {
  let afterClosed$: Subject<unknown>;
  let closeSpy: jasmine.Spy;
  let unsubscribeSpy: jasmine.Spy;
  let locationCb: ((value: PopStateEvent) => void) | undefined;
  let dialogState: MatDialogState;
  let dialogRef: Partial<MatDialogRef<DialogFullscreenMarkdownComponent>>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let location: jasmine.SpyObj<Location>;

  beforeEach(() => {
    afterClosed$ = new Subject<unknown>();
    closeSpy = jasmine.createSpy('close');
    unsubscribeSpy = jasmine.createSpy('unsubscribe');
    locationCb = undefined;
    dialogState = MatDialogState.OPEN;

    dialogRef = {
      afterClosed: () => afterClosed$.asObservable(),
      componentInstance: { close: closeSpy } as never,
      getState: () => dialogState,
    };
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    matDialog.open.and.returnValue(dialogRef as never);
    location = jasmine.createSpyObj('Location', ['subscribe']);
    location.subscribe.and.callFake((cb: (value: PopStateEvent) => void) => {
      locationCb = cb;
      return { unsubscribe: unsubscribeSpy } as never;
    });
  });

  const open = (): MatDialogRef<DialogFullscreenMarkdownComponent> =>
    openFullscreenMarkdownDialog(matDialog, location, { content: 'x' });
  const navigate = (): void => locationCb!({} as PopStateEvent);

  // The default closeOnNavigation disposes the overlay with no result on a
  // navigation, dropping the edit (#8434); we must opt out so we can close it
  // through the save path instead.
  it('opens DialogFullscreenMarkdownComponent fullscreen with closeOnNavigation disabled', () => {
    open();

    const [component, config] = matDialog.open.calls.mostRecent().args;
    expect(component).toBe(DialogFullscreenMarkdownComponent);
    expect(config?.closeOnNavigation).toBe(false);
    expect(config?.minWidth).toBe('100vw');
    expect(config?.data).toEqual({ content: 'x' });
  });

  // A navigation while the editor is open — an Android back-button press, or
  // the involuntary route change a breakpoint-crossing window resize fires —
  // must close the dialog through its save path rather than silently drop it.
  it('closes the dialog via its save path on a navigation', () => {
    open();
    expect(closeSpy).not.toHaveBeenCalled();

    navigate();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  // A breakpoint-crossing resize can emit more than one popstate; the second
  // must not re-trigger close() and re-run the dialog's exit animation.
  it('does not close again once the dialog is already closing', () => {
    open();
    navigate();
    dialogState = MatDialogState.CLOSING;

    navigate();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('stops listening for navigations once the dialog has closed', () => {
    open();

    afterClosed$.next(undefined);

    expect(unsubscribeSpy).toHaveBeenCalled();
  });
});
