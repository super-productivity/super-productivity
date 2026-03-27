import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MarkdownBlock } from '../document-block.model';
import { InlineMarkdownComponent } from '../../../ui/inline-markdown/inline-markdown.component';

@Component({
  selector: 'document-markdown-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineMarkdownComponent],
  template: `
    <inline-markdown
      [model]="block().content"
      [isShowControls]="true"
      [placeholderTxt]="'Write markdown...'"
      (changed)="contentChanged.emit($event)"
    ></inline-markdown>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      :host ::ng-deep .markdown-wrapper {
        min-height: 1.6em;
      }
    `,
  ],
})
export class DocumentMarkdownBlockComponent {
  block = input.required<MarkdownBlock>();
  contentChanged = output<string>();
  deleteBlock = output<void>();

  focus(): void {
    // InlineMarkdownComponent handles its own focus
  }

  focusAtOffset(_offset: number): void {
    // Not applicable for markdown blocks
  }
}
