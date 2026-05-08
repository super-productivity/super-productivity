import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { selectArchivedProjects } from '../../features/project/store/project.selectors';
import { ProjectService } from '../../features/project/project.service';
import { DEFAULT_PROJECT_ICON } from '../../features/project/project.const';
import { T } from '../../t.const';

@Component({
  selector: 'archived-projects-page',
  templateUrl: './archived-projects-page.component.html',
  styleUrls: ['./archived-projects-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatIconButton,
    MatIcon,
    MatTooltip,
    MatFormField,
    MatLabel,
    MatInput,
    MatSuffix,
    FormsModule,
    TranslatePipe,
  ],
})
export class ArchivedProjectsPageComponent {
  private readonly _store = inject(Store);
  private readonly _projectService = inject(ProjectService);

  readonly T = T;
  readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;

  readonly searchTerm = signal('');

  private readonly _allArchivedProjects = toSignal(
    this._store.select(selectArchivedProjects),
    { initialValue: [] },
  );

  readonly filteredProjects = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const sorted = [...this._allArchivedProjects()].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    if (!term) return sorted;
    return sorted.filter((p) => p.title.toLowerCase().includes(term));
  });

  unarchive(projectId: string): void {
    this._projectService.unarchive(projectId);
  }
}
