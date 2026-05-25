import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { TaskAttachmentType } from '../task-attachment.model';
import { TaskAttachmentLinkDirective } from './task-attachment-link.directive';

@Component({
  template: `
    <a
      taskAttachmentLink
      [href]="href"
      [type]="type"
    >
      Open
    </a>
  `,
  imports: [TaskAttachmentLinkDirective],
})
class TestHostComponent {
  href = 'https://example.com';
  type: TaskAttachmentType = 'LINK';
}

describe('TaskAttachmentLinkDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(async () => {
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{ provide: SnackService, useValue: snackService }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
  });

  it('should block local file urls outside electron', () => {
    fixture.componentInstance.href =
      'file://c:/Users/Youss/AppData/Roaming/superProductivity/clipboard-images/test.png';
    fixture.detectChanges();
    spyOn(window, 'open');

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBeTrue();
    expect(window.open).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.F.ATTACHMENT.LOCAL_FILE_UNAVAILABLE,
      type: 'ERROR',
    });
  });

  it('should block local file urls before browser navigation for image attachments', () => {
    fixture.componentInstance.href = 'file:///home/user/clipboard-images/test.png';
    fixture.componentInstance.type = 'IMG';
    fixture.detectChanges();
    spyOn(window, 'open');

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBeTrue();
    expect(window.open).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.F.ATTACHMENT.LOCAL_FILE_UNAVAILABLE,
      type: 'ERROR',
    });
  });

  it('should keep opening regular links outside electron', () => {
    fixture.detectChanges();
    spyOn(window, 'open').and.returnValue(null);

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBeFalse();
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank');
    expect(snackService.open).not.toHaveBeenCalled();
  });
});
