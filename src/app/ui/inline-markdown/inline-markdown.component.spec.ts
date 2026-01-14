import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MarkdownModule } from 'ngx-markdown';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { InlineMarkdownComponent } from './inline-markdown.component';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

describe('InlineMarkdownComponent', () => {
  let component: InlineMarkdownComponent;
  let fixture: ComponentFixture<InlineMarkdownComponent>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      misc: jasmine.createSpy().and.returnValue({ isTurnOffMarkdown: false }),
    });
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [
        InlineMarkdownComponent,
        MarkdownModule.forRoot(),
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: MatDialog, useValue: mockMatDialog },
        provideMockStore(),
        provideMockActions(() => of()),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InlineMarkdownComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnDestroy', () => {
    it('should emit changed event with current value when in edit mode and value has changed', () => {
      // Arrange
      const originalValue = 'original text';
      const changedValue = 'changed text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with changed value
      const mockTextareaEl = {
        nativeElement: { value: changedValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(changedValue);
    });

    it('should not emit changed event when in edit mode but value has not changed', () => {
      // Arrange
      const originalValue = 'original text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with unchanged value
      const mockTextareaEl = {
        nativeElement: { value: originalValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should not emit changed event when not in edit mode', () => {
      // Arrange
      const originalValue = 'original text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Ensure we're not in edit mode
      component['isShowEdit'].set(false);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should not emit changed event when textarea element is not available', () => {
      // Arrange
      spyOn(component.changed, 'emit');

      component.model = 'some text';
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element as undefined
      spyOn(component, 'textareaEl').and.returnValue(undefined);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should clear timeout and still emit changed event if needed', () => {
      // Arrange
      const originalValue = 'original text';
      const changedValue = 'changed text';
      spyOn(component.changed, 'emit');
      spyOn(window, 'clearTimeout');

      // Set up a timeout to be cleared
      component['_hideOverFlowTimeout'] = window.setTimeout(() => {}, 1000);

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with changed value
      const mockTextareaEl = {
        nativeElement: { value: changedValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(window.clearTimeout).toHaveBeenCalled();
      expect(component.changed.emit).toHaveBeenCalledWith(changedValue);
    });
  });
});
