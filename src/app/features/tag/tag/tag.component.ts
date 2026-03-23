import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  Signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { isSingleEmoji } from '../../../util/extract-first-emoji';

export interface TagComponentTag {
  title: string;
  icon?: string;
  svgIcon?: string;
  color?: string;
  theme?: {
    primary: string;
  };

  [key: string]: any;
}

@Component({
  selector: 'tag',
  templateUrl: './tag.component.html',
  styleUrls: ['./tag.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon],
  standalone: true,
})
export class TagComponent {
  tag = input.required<TagComponentTag>();
  isHideTitle = input(false);

  // @HostBinding('style.background')
  color: Signal<string | undefined> = computed(() => {
    const currentTag = this.tag();
    return currentTag.color || (currentTag.theme && currentTag.theme.primary);
  });

  isEmojiIcon: Signal<boolean> = computed(() => {
    const currentTag = this.tag();
    return currentTag.icon ? isSingleEmoji(currentTag.icon) : false;
  });
}
