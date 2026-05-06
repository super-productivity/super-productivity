import { TaskCopy } from '../../../tasks/task.model';
import { GiteaCommonInterfacesService } from './gitea-common-interfaces.service';
import { GiteaIssue } from './gitea-issue.model';

type AddTaskData = Partial<Readonly<TaskCopy>> & { title: string };

describe('GiteaCommonInterfacesService', () => {
  // getAddTaskData is a pure formatter that doesn't touch any injected
  // dependency, so call it off the prototype without going through DI.
  const getAddTaskData = (issue: GiteaIssue): AddTaskData =>
    GiteaCommonInterfacesService.prototype.getAddTaskData.call(
      null as unknown as GiteaCommonInterfacesService,
      issue,
    );

  describe('getAddTaskData', () => {
    const baseIssue = {
      id: 98765,
      number: 42,
      title: 'Example issue',
      state: 'open',
      updated_at: '2025-01-20T12:00:00Z',
    } as unknown as GiteaIssue;

    it('should set issueId from issue.number (not issue.id) so polling uses the per-repo number', () => {
      const result = getAddTaskData(baseIssue);
      expect(result.issueId).toBe('42');
    });

    it('should set isDone=true when issue.state is closed', () => {
      const result = getAddTaskData({ ...baseIssue, state: 'closed' } as GiteaIssue);
      expect(result.isDone).toBe(true);
    });

    it('should set isDone=false when issue.state is open', () => {
      const result = getAddTaskData(baseIssue);
      expect(result.isDone).toBe(false);
    });
  });
});
