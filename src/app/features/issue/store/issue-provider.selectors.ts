import { createFeatureSelector, createSelector } from '@ngrx/store';
import {
  ISSUE_PROVIDER_FEATURE_KEY,
  issueProvidersFeature,
} from './issue-provider.reducer';
import {
  IssueProvider,
  IssueProviderCalendar,
  IssueProviderKey,
  IssueProviderState,
} from '../issue.model';
import { ICAL_TYPE } from '../issue.const';

export const selectIssueProviderState = createFeatureSelector<IssueProviderState>(
  ISSUE_PROVIDER_FEATURE_KEY,
);

export const { selectIds, selectEntities, selectAll, selectTotal } =
  issueProvidersFeature;

export const selectEnabledIssueProviders = createSelector(
  selectAll,

  (issueProviders: IssueProvider[]): IssueProvider[] =>
    issueProviders.filter(
      // TODO fix type
      (issueProvider: IssueProvider) => issueProvider && (issueProvider as any).isEnabled,
    ),
);

export const selectIssueProvidersWithDisabledLast = createSelector(
  selectAll,
  (issueProviders: IssueProvider[]): IssueProvider[] => {
    const enabled = issueProviders.filter((ip) => ip?.isEnabled);
    const disabled = issueProviders.filter((ip) => ip && !ip.isEnabled);
    return [...enabled, ...disabled];
  },
);

export const selectIssueProviderById = <T extends IssueProvider>(
  id: string,
  issueProviderKey: IssueProviderKey | null,
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) =>
  createSelector(selectIssueProviderState, ({ entities }) => {
    const issueProvider = entities[id];
    if (!issueProvider) {
      // Do not include the entity in the error — IssueLog history is exportable
      // and providers may carry credentials.
      throw new Error(`No issueProvider found for id ${id}`);
    }
    if (issueProviderKey && issueProvider.issueProviderKey !== issueProviderKey) {
      throw new Error(
        `IssueProvider found for id ${id} is not of type ${issueProviderKey} but ${issueProvider.issueProviderKey}`,
      );
    }

    return issueProvider as T;
  });

// TODO rename to enabled calendar providers or change code
export const selectCalendarProviders = createSelector(
  selectEnabledIssueProviders,
  (issueProviders): IssueProviderCalendar[] =>
    issueProviders.filter(
      (ip): ip is IssueProviderCalendar => ip.issueProviderKey === ICAL_TYPE,
    ),
);

export const selectCalendarProviderById = createSelector(
  selectCalendarProviders,
  (calProviders, props: { id: string }): IssueProviderCalendar | undefined =>
    calProviders.find((calProvider) => calProvider.id === props.id),
);
