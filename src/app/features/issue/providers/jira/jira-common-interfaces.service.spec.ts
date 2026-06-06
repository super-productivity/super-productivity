import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { JiraCommonInterfacesService } from './jira-common-interfaces.service';
import { JiraApiService } from './jira-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { DEFAULT_JIRA_CFG } from './jira.const';
import { JiraCfg } from './jira.model';

const baseCfg: JiraCfg = {
  ...DEFAULT_JIRA_CFG,
  isEnabled: true,
  host: 'https://jira.internal',
  userName: 'user',
  password: 'pass',
};

describe('JiraCommonInterfacesService', () => {
  let service: JiraCommonInterfacesService;
  let issueProviderService: jasmine.SpyObj<IssueProviderService>;

  beforeEach(() => {
    issueProviderService = jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']);

    TestBed.configureTestingModule({
      providers: [
        JiraCommonInterfacesService,
        { provide: JiraApiService, useValue: {} },
        { provide: IssueProviderService, useValue: issueProviderService },
      ],
    });
    service = TestBed.inject(JiraCommonInterfacesService);
  });

  describe('issueLink', () => {
    it('throws when issueId is empty', () => {
      expect(() => service.issueLink('', 'provider-1')).toThrow();
    });

    it('throws when issueProviderId is empty', () => {
      expect(() => service.issueLink('PROJ-123', '')).toThrow();
    });

    it('uses host for browse URL when altPublicLinkHost is null', async () => {
      issueProviderService.getCfgOnce$.and.returnValue(of(baseCfg as any));
      const url = await service.issueLink('PROJ-123', 'provider-1');
      expect(url).toBe('https://jira.internal/browse/PROJ-123');
    });

    it('uses altPublicLinkHost for browse URL when set', async () => {
      const cfg: JiraCfg = { ...baseCfg, altPublicLinkHost: 'https://jira.public' };
      issueProviderService.getCfgOnce$.and.returnValue(of(cfg as any));
      const url = await service.issueLink('PROJ-456', 'provider-1');
      expect(url).toBe('https://jira.public/browse/PROJ-456');
    });

    it('falls back to host when altPublicLinkHost is empty string', async () => {
      const cfg: JiraCfg = { ...baseCfg, altPublicLinkHost: '' };
      issueProviderService.getCfgOnce$.and.returnValue(of(cfg as any));
      const url = await service.issueLink('PROJ-789', 'provider-1');
      expect(url).toBe('https://jira.internal/browse/PROJ-789');
    });

    it('includes numeric issueId in the URL', async () => {
      issueProviderService.getCfgOnce$.and.returnValue(of(baseCfg as any));
      const url = await service.issueLink(42, 'provider-1');
      expect(url).toBe('https://jira.internal/browse/42');
    });
  });
});
