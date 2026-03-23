import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { PasswordStrengthComponent } from './password-strength.component';

describe('PasswordStrengthComponent', () => {
  let component: PasswordStrengthComponent;
  let fixture: ComponentFixture<PasswordStrengthComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordStrengthComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(PasswordStrengthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('level (weak)', () => {
    it('should be weak for empty password', () => {
      fixture.componentRef.setInput('password', '');
      fixture.detectChanges();
      expect(component.level()).toBe('weak');
    });

    it('should be weak for password shorter than minLength', () => {
      fixture.componentRef.setInput('password', 'short');
      fixture.detectChanges();
      expect(component.level()).toBe('weak');
    });

    it('should be weak for 8+ chars with only lowercase', () => {
      fixture.componentRef.setInput('password', 'abcdefgh');
      fixture.detectChanges();
      expect(component.level()).toBe('weak');
    });

    it('should be weak for 8+ chars with only uppercase', () => {
      fixture.componentRef.setInput('password', 'ABCDEFGH');
      fixture.detectChanges();
      expect(component.level()).toBe('weak');
    });

    it('should be weak for 8+ chars with only digits', () => {
      fixture.componentRef.setInput('password', '12345678');
      fixture.detectChanges();
      expect(component.level()).toBe('weak');
    });
  });

  describe('level (fair)', () => {
    it('should be fair for 8+ chars with mixed case', () => {
      // score: mixedCase=1, that's only 1 → weak. Need 2.
      // 8+ chars with mixed case + digits = score 2
      fixture.componentRef.setInput('password', 'Abcdefg1');
      fixture.detectChanges();
      expect(component.level()).toBe('fair');
    });

    it('should be fair for 12+ chars with lowercase + digits', () => {
      // score: length>=12=1, digits=1 = 2
      fixture.componentRef.setInput('password', 'abcdefghij12');
      fixture.detectChanges();
      expect(component.level()).toBe('fair');
    });

    it('should be fair for 8+ chars with mixed case and special chars (score 2-3)', () => {
      // score: mixedCase=1, special=1 = 2
      fixture.componentRef.setInput('password', 'Abcdefg!');
      fixture.detectChanges();
      expect(component.level()).toBe('fair');
    });
  });

  describe('level (strong)', () => {
    it('should be strong for 12+ chars with mixed case, digits, and special chars', () => {
      // score: length>=12=1, mixedCase=1, digits=1, special=1 = 4
      fixture.componentRef.setInput('password', 'Abcdefgh12!@');
      fixture.detectChanges();
      expect(component.level()).toBe('strong');
    });

    it('should be strong for 16+ chars with mixed case and digits', () => {
      // score: length>=12=1, length>=16=1, mixedCase=1, digits=1 = 4
      fixture.componentRef.setInput('password', 'Abcdefghijklmn12');
      fixture.detectChanges();
      expect(component.level()).toBe('strong');
    });
  });

  describe('fillPercent', () => {
    it('should return 33 for weak', () => {
      fixture.componentRef.setInput('password', 'abc');
      fixture.detectChanges();
      expect(component.fillPercent()).toBe(33);
    });

    it('should return 66 for fair', () => {
      fixture.componentRef.setInput('password', 'Abcdefg1');
      fixture.detectChanges();
      expect(component.fillPercent()).toBe(66);
    });

    it('should return 100 for strong', () => {
      fixture.componentRef.setInput('password', 'Abcdefgh12!@');
      fixture.detectChanges();
      expect(component.fillPercent()).toBe(100);
    });
  });

  describe('custom minLength', () => {
    it('should respect non-default minLength', () => {
      fixture.componentRef.setInput('minLength', 12);
      fixture.componentRef.setInput('password', 'Abcdefg1');
      fixture.detectChanges();
      // 8 chars < minLength of 12 → weak
      expect(component.level()).toBe('weak');
    });

    it('should allow shorter minLength', () => {
      fixture.componentRef.setInput('minLength', 4);
      // 'Ab1!' = 4 chars with mixed case + digits + special = score 3 → fair
      fixture.componentRef.setInput('password', 'Ab1!');
      fixture.detectChanges();
      expect(component.level()).toBe('fair');
    });
  });
});
