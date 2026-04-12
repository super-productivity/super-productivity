import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TrashPageComponent } from './trash-page.component';

describe('TrashPageComponent', () => {
  let component: TrashPageComponent;
  let fixture: ComponentFixture<TrashPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TrashPageComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
