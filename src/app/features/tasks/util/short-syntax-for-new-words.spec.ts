import { shortSyntaxForNewWords } from './short-syntax-for-new-words';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DEFAULT_TASK, Task } from '../task.model';
import { Tag } from '../../tag/tag.model';

describe('shortSyntaxForNewWords', () => {
  const cfg = DEFAULT_GLOBAL_CONFIG.shortSyntax;
  const tags = [{ id: 'tag-urgent', title: 'urgent' }] as Tag[];
  const task = (title: string): Task =>
    ({
      ...DEFAULT_TASK,
      id: 't1',
      title,
      tagIds: [],
      issueId: 'item-1',
    }) as unknown as Task;
  const parse = (
    keptTitle: string | undefined,
    title: string,
  ): ReturnType<typeof shortSyntaxForNewWords> =>
    shortSyntaxForNewWords(keptTitle, task(title), cfg, tags, [], undefined, 'replace');

  it('leaves tags, dates and estimates of the kept title as text', async () => {
    expect(
      await parse('Prep #urgent for @fri 30m', 'Prepare #urgent for @fri 30m'),
    ).toBeUndefined();
  });

  it('parses only the words typed since, keeping the others in place', async () => {
    const r = await parse('Prep #urgent for @fri 30m', 'Prep #urgent for 1h @fri 30m');

    expect(r?.taskChanges).toEqual({
      title: 'Prep #urgent for @fri 30m',
      timeEstimate: 3600000,
    });
  });

  it('parses a newly typed tag', async () => {
    const r = await parse('Fix bug', 'Fix bug #urgent');

    expect(r?.taskChanges).toEqual({ title: 'Fix bug', tagIds: ['tag-urgent'] });
  });

  it('parses a newly typed date in front of kept words without eating them', async () => {
    const r = await parse('Call Bob 5pm about it', 'Call @tomorrow Bob 5pm about it');

    // (the double space a mid-title date leaves is plain shortSyntax's)
    expect(r?.taskChanges.title).toBe('Call  Bob 5pm about it');
    expect(r?.taskChanges.dueWithTime).toEqual(jasmine.any(Number));
    expect(r?.taskChanges.hasPlannedTime).toBe(false);
  });

  it('parses the whole title without a kept title', async () => {
    const r = await parse(undefined, 'Prep #urgent 30m');

    expect(r?.taskChanges).toEqual({
      title: 'Prep',
      timeEstimate: 1800000,
      tagIds: ['tag-urgent'],
    });
  });

  it('does not parse a title that already holds private-use characters', async () => {
    expect(await parse('Prep', 'Prep  #urgent')).toBeUndefined();
  });
});
