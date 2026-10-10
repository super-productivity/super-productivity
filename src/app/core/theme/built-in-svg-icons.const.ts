/** SVG icons registered with `MatIconRegistry` at startup, as `[name, path]`. */
export const BUILT_IN_SVG_ICONS: readonly (readonly [string, string])[] = [
  ['sp', 'assets/icons/sp.svg'],
  ['github', 'assets/icons/github.svg'],
  ['gitlab', 'assets/icons/gitlab.svg'],
  ['jira', 'assets/icons/jira.svg'],
  ['caldav', 'assets/icons/caldav.svg'],
  ['calendar', 'assets/icons/calendar.svg'],
  ['open_project', 'assets/icons/open-project.svg'],
  ['remove_today', 'assets/icons/remove-today-48px.svg'],
  ['gitea', 'assets/icons/gitea.svg'],
  ['redmine', 'assets/icons/redmine.svg'],
  ['linear', 'assets/icons/linear.svg'],
  ['clickup', 'assets/icons/clickup.svg'],
  // trello icon
  ['trello', 'assets/icons/trello.svg'],
  ['azure_devops', 'assets/icons/azure_devops.svg'],
  ['nextcloud_deck', 'assets/icons/nextcloud_deck.svg'],
  ['plainspace', 'assets/icons/plainspace.svg'],
];

export const BUILT_IN_SVG_ICON_NAMES: ReadonlySet<string> = new Set(
  BUILT_IN_SVG_ICONS.map(([name]) => name),
);
