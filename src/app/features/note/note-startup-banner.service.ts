import { inject, Injectable } from '@angular/core';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { take } from 'rxjs/operators';
import { getDbDateStr } from '../../util/get-db-date-str';
import { LS } from '../../core/persistence/storage-keys.const';
import { devError } from '../../util/dev-error';
import { T } from '../../t.const';
import { MetricService } from '../metric/metric.service';

interface LastViewedNote {
  noteId: string;
  day: string;
}

@Injectable({ providedIn: 'root' })
export class NoteStartupBannerService {
  private readonly _metricService = inject(MetricService);
  private readonly _bannerService = inject(BannerService);

  async showLastNoteIfNeeded(): Promise<void> {
    const todayStr = getDbDateStr();
    const metric = await this._metricService
      .getMetricForDay$(todayStr)
      .pipe(take(1))
      .toPromise();

    const reflection = metric?.reflections?.[0];
    if (!reflection?.text?.trim()) {
      return;
    }

    const lastViewed = this._getLastViewedNote();
    // Use metric.id (date string) as the identifier for tracking
    if (lastViewed?.noteId === metric.id && lastViewed.day === todayStr) {
      return;
    }

    const content = this._getContent(reflection.text);
    const createdDate = new Date(reflection.created).toLocaleDateString();

    this._bannerService.open({
      id: BannerId.StartupNote,
      msg: T.F.REFLECTION_NOTE.MSG,
      ico: 'note',
      translateParams: {
        content,
        date: createdDate,
      },
      action: {
        label: T.F.REFLECTION_NOTE.ACTION_DISMISS,
        fn: () => this._setLastViewed(metric.id, todayStr),
      },
      isHideDismissBtn: true,
    });
  }

  private _getContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim();
  }

  private _getLastViewedNote(): LastViewedNote | null {
    const raw = localStorage.getItem(LS.LAST_NOTE_BANNER_DAY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as LastViewedNote;
      if (!parsed.noteId || !parsed.day) {
        throw new Error('Invalid last note banner local storage value');
      }
      return parsed;
    } catch (e) {
      devError(e);
      return null;
    }
  }

  private _setLastViewed(noteId: string, day: string): void {
    localStorage.setItem(
      LS.LAST_NOTE_BANNER_DAY,
      JSON.stringify({
        noteId,
        day,
      }),
    );
  }
}
