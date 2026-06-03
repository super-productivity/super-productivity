import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DueDateConfigComponent } from './due-date-config.component';
import { RepeatDueConfig } from '../../task-repeat-cfg.model';

describe('DueDateConfigComponent', () => {
  let fixture: ComponentFixture<DueDateConfigComponent>;
  let component: DueDateConfigComponent;

  const setup = async (config?: RepeatDueConfig): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [DueDateConfigComponent, TranslateModule.forRoot(), NoopAnimationsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(DueDateConfigComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('config', config);
    fixture.detectChanges();
  };

  it('defaults to ON_OCCURRENCE when no config is provided', async () => {
    await setup();
    expect(component.dueType()).toBe('ON_OCCURRENCE');
  });

  it('emits a clean config when an OFFSET due type is chosen', async () => {
    await setup();
    const emitted: RepeatDueConfig[] = [];
    component.configChange.subscribe((c) => emitted.push(c));
    component.setDueType('OFFSET');
    expect(emitted[emitted.length - 1]).toEqual({
      dueType: 'OFFSET',
      dueOffset: 1,
      dueOffsetUnit: 'DAY',
    });
    component.setDueOffset('3');
    expect(emitted[emitted.length - 1].dueOffset).toBe(3);
  });

  it('switching the due type drops params that no longer apply', async () => {
    await setup();
    const emitted: RepeatDueConfig[] = [];
    component.configChange.subscribe((c) => emitted.push(c));
    component.setDueType('OFFSET');
    component.setDueType('PERIOD_END');
    const last = emitted[emitted.length - 1];
    expect(last).toEqual({ dueType: 'PERIOD_END', duePeriod: 'MONTH' });
    expect(last.dueOffset).toBeUndefined();
  });

  it('emits UNTIL_NEXT with no extra params (usable on any preset)', async () => {
    await setup();
    const emitted: RepeatDueConfig[] = [];
    component.configChange.subscribe((c) => emitted.push(c));
    component.setDueType('UNTIL_NEXT');
    expect(emitted[emitted.length - 1]).toEqual({ dueType: 'UNTIL_NEXT' });
  });

  it('restores the config from the input', async () => {
    await setup({ dueType: 'FIXED', dueFixedDate: '2026-12-31' });
    expect(component.dueType()).toBe('FIXED');
    expect(component.due().dueFixedDate).toBe('2026-12-31');
  });
});
