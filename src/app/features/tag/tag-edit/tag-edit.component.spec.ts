import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';

import { TagEditComponent } from './tag-edit.component';
import { TagService } from '../tag.service';
import { TaskService } from '../../tasks/task.service';
import { Tag } from '../tag.model';

describe('TagEditComponent', () => {
  let fixture: ComponentFixture<TagEditComponent>;
  let component: TagEditComponent;

  const sidebarOrderTags: Tag[] = [
    { id: 'tag-ux', title: 'UX' } as Tag,
    { id: 'tag-dev', title: 'Development' } as Tag,
  ];
  const alphabeticalTags: Tag[] = [...sidebarOrderTags].reverse();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TagEditComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        {
          provide: TagService,
          useValue: {
            tagsSortedForUI: signal(alphabeticalTags),
            tagsNoMyDayAndNoList: signal(sidebarOrderTags),
            tagsNoMyDayAndNoListSorted: signal(alphabeticalTags),
          },
        },
        {
          provide: TaskService,
          useValue: {},
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TagEditComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tagIds', []);
    fixture.detectChanges();
  });

  it('should show regular tag suggestions in sidebar order', () => {
    expect(component.tagSuggestions()).toEqual(sidebarOrderTags);
  });
});
