import { createFeatureSelector, createSelector } from '@ngrx/store';
import {
  ISSUE_PROVIDER_FEATURE_KEY,
  issueProvidersFeature,
} from './issue-provider.reducer';
import {
  IssueProvider,
  IssueProviderCalendar,
  IssueProviderKey,
  IssueProviderPlainspace,
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

/**
 * The `PLAINSPACE` issue provider bound to a project (i.e. the space it is
 * shared/collaborated on), or undefined. Includes disabled providers so both the
 * "Collaborate on Plainspace" entry point (hidden once shared) and the "Open in
 * Plainspace" action (shown once shared) stay consistent — a disabled provider
 * still counts as shared. Returns the first match; a project is expected to have
 * at most one bound space.
 */
export const selectPlainspaceProviderForProject = (
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) =>
  createSelector(
    selectAll,
    (issueProviders: IssueProvider[]): IssueProviderPlainspace | undefined =>
      issueProviders.find(
        (ip): ip is IssueProviderPlainspace =>
          !!ip &&
          ip.issueProviderKey === 'PLAINSPACE' &&
          ip.defaultProjectId === projectId,
      ),
  );

/**
 * Whether a project already has a bound `PLAINSPACE` issue provider. See
 * {@link selectPlainspaceProviderForProject} for why disabled providers count.
 */
export const selectIsProjectSharedOnPlainspace = (
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) =>
  createSelector(
    selectPlainspaceProviderForProject(projectId),
    (provider): boolean => !!provider,
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
