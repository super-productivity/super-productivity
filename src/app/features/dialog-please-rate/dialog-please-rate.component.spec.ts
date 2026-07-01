import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';

import { DialogPleaseRateComponent } from './dialog-please-rate.component';
import { RateDialogResult } from './rate-dialog-state';

describe('DialogPleaseRateComponent', () => {
  let component: DialogPleaseRateComponent;
  let fixture: ComponentFixture<DialogPleaseRateComponent>;
  let mockDialogRef: jasmine.SpyObj<
    MatDialogRef<DialogPleaseRateComponent, RateDialogResult>
  >;

  // The view/nav members are `protected`; access them through typed casts so the
  // spec exercises real behaviour without widening the component's API.
  const view = (): string => (component as unknown as { view: () => string }).view();
  const nav = (m: 'showMain' | 'showFeedback'): void =>
    (component as unknown as Record<string, () => void>)[m]();
  const close = (r: RateDialogResult): void =>
    (component as unknown as { close: (r: RateDialogResult) => void }).close(r);

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [
        DialogPleaseRateComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [{ provide: MatDialogRef, useValue: mockDialogRef }],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogPleaseRateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens on the main view (store CTA shown to everyone — no sentiment gate)', () => {
    expect(view()).toBe('main');
  });

  it('navigates to the feedback view and back', () => {
    nav('showFeedback');
    expect(view()).toBe('feedback');
    nav('showMain');
    expect(view()).toBe('main');
  });

  it('navigating to feedback never closes the dialog or opts the user out', () => {
    nav('showFeedback');
    nav('showMain');
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('forwards each explicit result to the dialog ref', () => {
    (['rate', 'feedback', 'later', 'never'] as RateDialogResult[]).forEach((r) => {
      close(r);
      expect(mockDialogRef.close).toHaveBeenCalledWith(r);
    });
  });
});
