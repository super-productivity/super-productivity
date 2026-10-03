import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { MentionConfigService } from './mention-config.service';
import { GlobalConfigService } from '../config/global-config.service';
import { TagService } from '../tag/tag.service';
import { ProjectService } from '../project/project.service';
import { ShortSyntaxConfig } from '../config/global-config.model';
import { MentionConfig } from '../../ui/mentions/mention-config';
import { shortSyntax } from './short-syntax';
import { REPEAT_SUGGESTIONS } from './add-task-bar/add-task-bar.const';
import { getDbDateStr } from '../../util/get-db-date-str';

const ALL_ENABLED: ShortSyntaxConfig = {
  isEnableTag: true,
  isEnableDue: true,
  isEnableDeadline: true,
  isEnableProject: true,
};

const titlesFor = (cfg: MentionConfig, triggerChar: string): string[] =>
  (cfg.mentions ?? [])
    .find((m) => m.triggerChar === triggerChar)!
    .items!.map((item) => (item as { title: string }).title);

describe('MentionConfigService', () => {
  let service: MentionConfigService;

  // Friday morning, so weekday and time-of-day suggestions resolve both
  // later today and on later days.
  const NOW = new Date(2026, 9, 2, 10, 0, 0);
  const TODAY_STR = getDbDateStr(NOW);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MentionConfigService,
        { provide: GlobalConfigService, useValue: { shortSyntax$: of(ALL_ENABLED) } },
        { provide: TagService, useValue: { tagsNoMyDayAndNoListSorted$: of([]) } },
        { provide: ProjectService, useValue: { listSortedForUI$: of([]) } },
      ],
    });
    service = TestBed.inject(MentionConfigService);
  });

  it('offers recurrence phrases only for the add task bar due-date trigger', async () => {
    const titleEditCfg = await firstValueFrom(service.mentionConfig$);
    const addTaskBarCfg = await firstValueFrom(service.addTaskBarMentionConfig$);

    expect(titlesFor(addTaskBarCfg, '@')).toEqual(
      jasmine.arrayContaining(REPEAT_SUGGESTIONS),
    );
    for (const phrase of REPEAT_SUGGESTIONS) {
      expect(titlesFor(titleEditCfg, '@')).not.toContain(phrase);
      expect(titlesFor(titleEditCfg, '!')).not.toContain(phrase);
      expect(titlesFor(addTaskBarCfg, '!')).not.toContain(phrase);
    }
  });

  // Picking a suggestion only inserts its text; if the parser does not
  // understand it, the text stays in the title and nothing is scheduled.
  describe('every suggestion is parsed where it is offered', () => {
    const expectParsed = async (
      cfg: MentionConfig,
      triggerChar: '@' | '!',
      isParseRepeat: boolean,
    ): Promise<void> => {
      for (const phrase of titlesFor(cfg, triggerChar)) {
        const r = await shortSyntax(
          { title: `Task ${triggerChar}${phrase}`, tagIds: [] },
          ALL_ENABLED,
          [],
          [],
          NOW,
          'combine',
          isParseRepeat,
        );
        const changes = r?.taskChanges;
        const label = `${triggerChar}${phrase}`;
        expect(changes?.title).withContext(label).toBe('Task');

        if (r?.repeat) {
          continue;
        }
        const isDue = triggerChar === '@';
        const withTime = isDue ? changes?.dueWithTime : changes?.deadlineWithTime;
        const day =
          typeof withTime === 'number'
            ? getDbDateStr(new Date(withTime))
            : isDue
              ? changes?.dueDay
              : changes?.deadlineDay;
        expect(day).withContext(label).toBeTruthy();
        expect(day! >= TODAY_STR)
          .withContext(`${label} resolves to ${day}, before today`)
          .toBeTrue();
      }
    };

    it('in the add task bar', async () => {
      const cfg = await firstValueFrom(service.addTaskBarMentionConfig$);
      await expectParsed(cfg, '@', true);
      await expectParsed(cfg, '!', true);
    });

    it('in title edits of existing tasks', async () => {
      const cfg = await firstValueFrom(service.mentionConfig$);
      await expectParsed(cfg, '@', false);
      await expectParsed(cfg, '!', false);
    });
  });
});
