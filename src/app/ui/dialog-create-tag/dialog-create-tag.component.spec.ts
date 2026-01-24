import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';

import { DialogCreateTagComponent } from './dialog-create-tag.component';

describe('DialogCreateTagComponent', () => {
  let component: DialogCreateTagComponent;
  let fixture: ComponentFixture<DialogCreateTagComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogCreateTagComponent>>;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [
        DialogCreateTagComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogCreateTagComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should close with tag data when save is called with valid title', () => {
    component.title = 'Test Tag';
    component.color = '#ff0000';

    component.close(true);

    expect(mockDialogRef.close).toHaveBeenCalledWith({
      title: 'Test Tag',
      icon: null,
      color: '#ff0000',
    });
  });

  it('should close with undefined when cancel is called', () => {
    component.close(false);

    expect(mockDialogRef.close).toHaveBeenCalledWith(undefined);
  });

  it('should close with undefined when save is called with empty title', () => {
    component.title = '   ';
    component.close(true);

    expect(mockDialogRef.close).toHaveBeenCalledWith(undefined);
  });
});
