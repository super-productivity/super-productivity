import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  ElementRef,
  HostBinding,
  inject,
  Input,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MarkdownComponent } from 'ngx-markdown';
import { IS_ELECTRON } from '../../app.constants';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { isMarkdownChecklist } from '../../features/markdown-checklist/is-markdown-checklist';
import { fadeInAnimation } from '../animations/fade.ani';
import { DialogFullscreenMarkdownComponent } from '../dialog-fullscreen-markdown/dialog-fullscreen-markdown.component';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { TaskAttachmentService } from '../../features/tasks/task-attachment/task-attachment.service';
import { ResolveClipboardImagesDirective } from '../../core/clipboard-image/resolve-clipboard-images.directive';
import { ClipboardPasteHandlerService } from '../../core/clipboard-image/clipboard-paste-handler.service';

const HIDE_OVERFLOW_TIMEOUT_DURATION = 300;

@Component({
  selector: 'inline-markdown',
  templateUrl: './inline-markdown.component.html',
  styleUrls: ['./inline-markdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeInAnimation],
  imports: [
    FormsModule,
    MarkdownComponent,
    MatIconButton,
    MatTooltip,
    MatIcon,
    ResolveClipboardImagesDirective,
  ],
})
export class InlineMarkdownComponent implements OnInit, OnDestroy {
  private _cd = inject(ChangeDetectorRef);
  private _globalConfigService = inject(GlobalConfigService);
  private _matDialog = inject(MatDialog);
  private _clipboardImageService = inject(ClipboardImageService);
  private _taskAttachmentService = inject(TaskAttachmentService);
  private _clipboardPasteHandler = inject(ClipboardPasteHandlerService);
  private _currentPastePlaceholder: string | null = null;

  readonly isLock = input<boolean>(false);
  readonly isShowControls = input<boolean>(false);
  readonly isShowChecklistToggle = input<boolean>(false);
  readonly isDefaultText = input<boolean>(false);
  readonly placeholderTxt = input<string | undefined>(undefined);
  readonly taskId = input<string | undefined>(undefined);

  readonly changed = output<string>();
  readonly focused = output<Event>();
  readonly blurred = output<Event>();
  readonly keyboardUnToggle = output<Event>();
  readonly wrapperEl = viewChild<ElementRef>('wrapperEl');
  readonly textareaEl = viewChild<ElementRef>('textareaEl');
  readonly previewEl = viewChild<MarkdownComponent>('previewEl');

  isHideOverflow = signal(false);
  isChecklistMode = signal(false);
  isShowEdit = signal(false);
  modelCopy = signal<string | undefined>(undefined);
  resolvedModel = signal<string | undefined>(undefined);
  // Plain property for markdown component compatibility
  resolvedMarkdownData: string | undefined;

  isMarkdownFormattingEnabled = computed(() => {
    const tasks = this._globalConfigService.tasks();
    return tasks?.isMarkdownFormattingInNotesEnabled ?? true;
  });

  isTurnOffMarkdownParsing = computed(() => !this.isMarkdownFormattingEnabled());
  private _hideOverFlowTimeout: number | undefined;

  constructor() {
    this.resizeParsedToFit();

    // Sync signal to plain property for markdown component
    effect(() => {
      this.resolvedMarkdownData = this.resolvedModel();
      this._cd.markForCheck();
    });
  }

  @HostBinding('class.isFocused') get isFocused(): boolean {
    return this.isShowEdit();
  }

  private _model: string | undefined;

  get model(): string | undefined {
    return this._model;
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set model(v: string) {
    this._model = v || '';
    this.modelCopy.set(v || '');

    // Start resolving but don't update the rendered model yet
    if (v) {
      this._updateResolvedModel(v);
    } else {
      this.resolvedModel.set(undefined);
    }

    if (!this.isShowEdit()) {
      window.setTimeout(() => {
        this.resizeParsedToFit();
      });
    }

    this.isChecklistMode.set(
      this.isChecklistMode() &&
        this.isShowChecklistToggle() &&
        !!v &&
        isMarkdownChecklist(v),
    );
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set isFocus(val: boolean) {
    if (!this.isShowEdit() && val) {
      this._toggleShowEdit();
    }
  }

  ngOnInit(): void {
    if (this.isLock()) {
      this._toggleShowEdit();
    } else {
      this.resizeParsedToFit();
    }
    if (IS_ELECTRON) {
      this._makeLinksWorkForElectron();
    }
  }

  ngOnDestroy(): void {
    if (this._hideOverFlowTimeout) {
      window.clearTimeout(this._hideOverFlowTimeout);
    }

    if (this.isShowEdit()) {
      const textareaEl = this.textareaEl();
      if (textareaEl) {
        const currentValue = textareaEl.nativeElement.value;
        if (currentValue !== this.model) {
          this.changed.emit(currentValue);
        }
      }
    }
  }

  checklistToggle(): void {
    this.isChecklistMode.set(!this.isChecklistMode());
  }

  keypressHandler(ev: KeyboardEvent): void {
    this.resizeTextareaToFit();

    if ((ev.key === 'Enter' && ev.ctrlKey) || ev.code === 'Escape') {
      this.untoggleShowEdit();
      this.keyboardUnToggle.emit(ev);
    }
  }

  async pasteHandler(ev: ClipboardEvent): Promise<void> {
    await this._clipboardPasteHandler.handlePaste(ev, {
      currentPlaceholder: {
        get: () => this._currentPastePlaceholder,
        set: (val) => (this._currentPastePlaceholder = val),
      },
      getContent: () => this._model || '',
      setContent: (content) => {
        this.modelCopy.set(content);
        this._model = content;
        this.changed.emit(content);
      },
      getTextarea: () => this.textareaEl()?.nativeElement || null,
      getTaskId: () => this.taskId() || null,
      onPasteComplete: async (content) => {
        this.resizeTextareaToFit();
        await this._updateResolvedModel(content);
      },
    });
  }

  clickPreview($event: MouseEvent): void {
    if (($event.target as HTMLElement).tagName === 'A') {
      // Let links work normally
      return;
    }

    // Check if click is anywhere inside a checkbox-wrapper (text or checkbox icon)
    const wrapper = ($event.target as HTMLElement).closest(
      '.checkbox-wrapper',
    ) as HTMLElement;
    if (wrapper) {
      this._handleCheckboxClick(wrapper);
    } else {
      this._toggleShowEdit();
    }
  }

  untoggleShowEdit(): void {
    if (!this.isLock()) {
      this.resizeParsedToFit();
      this.isShowEdit.set(false);
    }
    const textareaEl = this.textareaEl();
    if (!textareaEl) {
      throw new Error('Textarea not visible');
    }
    this.modelCopy.set(textareaEl.nativeElement.value);

    if (this.modelCopy() !== this.model) {
      this.model = this.modelCopy() || '';
      this.changed.emit(this.modelCopy() as string);
    }
  }

  resizeTextareaToFit(): void {
    this._hideOverflow();
    const textareaEl = this.textareaEl();
    if (!textareaEl) {
      throw new Error('Textarea not visible');
    }
    const wrapperEl = this.wrapperEl();
    if (!wrapperEl) {
      throw new Error('Wrapper el not visible');
    }
    textareaEl.nativeElement.style.height = 'auto';
    textareaEl.nativeElement.style.height = textareaEl.nativeElement.scrollHeight + 'px';
    wrapperEl.nativeElement.style.height = textareaEl.nativeElement.offsetHeight + 'px';
  }

  openFullScreen(): void {
    const dialogRef = this._matDialog.open(DialogFullscreenMarkdownComponent, {
      minWidth: '100vw',
      height: '100vh',
      restoreFocus: true,
      autoFocus: 'textarea',
      data: {
        content: this.modelCopy(),
        taskId: this.taskId(),
      },
    });

    let lastEmittedContent: string | null = null;

    // Subscribe to live auto-save updates from fullscreen dialog
    dialogRef.componentInstance.contentChanged.subscribe((content: string) => {
      lastEmittedContent = content;
      this.modelCopy.set(content);
      this.changed.emit(content);
    });

    dialogRef.afterClosed().subscribe((res) => {
      // Only emit if content differs from last auto-saved content
      if (typeof res === 'string' && res !== lastEmittedContent) {
        this.modelCopy.set(res);
        this.changed.emit(res);
      }
    });
  }

  resizeParsedToFit(): void {
    this._hideOverflow();

    setTimeout(() => {
      const previewEl = this.previewEl();
      if (!previewEl) {
        if (this.textareaEl()) {
          this.resizeTextareaToFit();
        }
        return;
      }
      const wrapperEl = this.wrapperEl();
      if (!wrapperEl) {
        throw new Error('Wrapper el not visible');
      }
      previewEl.element.nativeElement.style.height = 'auto';
      // NOTE: somehow this pixel seem to help
      wrapperEl.nativeElement.style.height =
        previewEl.element.nativeElement.offsetHeight + 'px';
      previewEl.element.nativeElement.style.height = '';
    });
  }

  setFocus(ev: Event): void {
    this.focused.emit(ev);
  }

  setBlur(ev: Event): void {
    this.blurred.emit(ev);
  }

  toggleChecklistMode(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();

    // If currently editing, save the current textarea content before toggling.
    // This prevents content loss when mousedown.preventDefault() blocks the blur event.
    const textareaEl = this.textareaEl();
    if (this.isShowEdit() && textareaEl) {
      const currentValue = textareaEl.nativeElement.value;
      if (currentValue !== this.model) {
        this.model = currentValue;
        this.changed.emit(currentValue);
      }
    }

    this.isChecklistMode.set(true);
    this._toggleShowEdit();

    if (this.isDefaultText()) {
      this.modelCopy.set('- [ ] ');
    } else {
      this.modelCopy.set(this.modelCopy() + '\n- [ ] ');
      // cleanup string on add
      this.modelCopy.set(
        this.modelCopy()
          ?.replace(/\n\n- \[/g, '\n- [')
          .replace(/^\n/g, ''),
      );
    }
  }

  private _toggleShowEdit(): void {
    this.isShowEdit.set(true);
    this.modelCopy.set(this.model || '');
    setTimeout(() => {
      const textareaEl = this.textareaEl();
      if (!textareaEl) {
        throw new Error('Textarea not visible');
      }
      textareaEl.nativeElement.value = this.modelCopy();
      textareaEl.nativeElement.focus();
      this.resizeTextareaToFit();
    });
  }

  private _hideOverflow(): void {
    this.isHideOverflow.set(true);
    if (this._hideOverFlowTimeout) {
      window.clearTimeout(this._hideOverFlowTimeout);
    }

    this._hideOverFlowTimeout = window.setTimeout(() => {
      this.isHideOverflow.set(false);
      this._cd.detectChanges();
    }, HIDE_OVERFLOW_TIMEOUT_DURATION);
  }

  private _makeLinksWorkForElectron(): void {
    const wrapperEl = this.wrapperEl();
    if (!wrapperEl) {
      throw new Error('Wrapper el not visible');
    }
    wrapperEl.nativeElement.addEventListener('click', (ev: MouseEvent) => {
      const target = ev.target as HTMLElement;
      if (target.tagName && target.tagName.toLowerCase() === 'a') {
        const href = target.getAttribute('href');
        if (href !== null) {
          ev.preventDefault();
          window.ea.openExternalUrl(href);
        }
      }
    });
  }

  private _handleCheckboxClick(targetEl: HTMLElement): void {
    const allCheckboxes =
      this.previewEl()?.element.nativeElement.querySelectorAll('.checkbox-wrapper');

    const checkIndex = Array.from(allCheckboxes || []).findIndex((el) => el === targetEl);
    if (checkIndex !== -1 && this._model) {
      const allLines = this._model.split('\n');
      const todoAllLinesIndexes = allLines
        .map((line, index) => (line.includes('- [') ? index : null))
        .filter((i) => i !== null);

      // Find all to-do items in the markdown string
      // Log.log(checkIndex, todoAllLinesIndexes, allLines);

      const itemIndex = todoAllLinesIndexes[checkIndex];
      if (typeof itemIndex === 'number' && itemIndex > -1) {
        const item = allLines[itemIndex];
        allLines[itemIndex] = item.includes('[ ]')
          ? item.replace('[ ]', '[x]').replace('[]', '[x]')
          : item.replace('[x]', '[ ]');
        this.modelCopy.set(allLines.join('\n'));

        // Update the markdown string
        if (this.modelCopy() !== this.model) {
          this.model = this.modelCopy() || '';
          this.changed.emit(this.modelCopy() as string);
        }
      }
    }
  }

  private async _updateResolvedModel(content: string | undefined): Promise<void> {
    if (!content) {
      this.resolvedModel.set(content);
      this._cd.markForCheck();
      return;
    }

    // First resolve all URLs in the markdown
    const resolved = await this._clipboardImageService.resolveMarkdownImages(content);
    this.resolvedModel.set(resolved);
  }
}
