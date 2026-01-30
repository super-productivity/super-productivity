import {
  ComponentFactoryResolver,
  Directive,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  output,
  Output,
  SimpleChanges,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import {
  getCaretPosition,
  getValue,
  insertValue,
  setCaretPosition,
  isInputOrTextAreaElement,
} from './mention-utils';

import { MentionConfig } from './mention-config';
import { MentionListComponent } from './mention-list.component';
import { Log } from '../../core/log';
import {
  MentionItem,
  MentionEvent,
  MentionNode,
  TextInputElement,
} from './mention-types';

// Custom types for mention events
interface CustomKeyboardEvent extends KeyboardEvent {
  inputEvent?: boolean;
  wasClick?: boolean;
}

const KEY_BACKSPACE = 8;
const KEY_TAB = 9;
const KEY_ENTER = 13;
const KEY_SHIFT = 16;
const KEY_ESCAPE = 27;
const KEY_SPACE = 32;
const KEY_UP = 38;
const KEY_DOWN = 40;
const KEY_BUFFERED = 229;

/**
 * Angular Mentions.
 * https://github.com/dmacfarlane/angular-mentions
 *
 * Copyright (c) 2017 Dan MacFarlane
 */
@Directive({
  selector: '[mention], [mentionConfig]',
  host: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '(keydown)': 'keyHandler($event)',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '(input)': 'inputHandler($event)',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '(blur)': 'blurHandler($event)',
    autocomplete: 'off',
  },
  standalone: true,
})
export class MentionDirective implements OnChanges {
  // stores the items passed to the mentions directive and used to populate the root items in mentionConfig
  private mentionItems: MentionItem[] | string[] = [];

  @Input('mention') set mention(items: MentionItem[] | string[]) {
    this.mentionItems = items;
  }

  // the provided configuration object
  @Input() mentionConfig: MentionConfig = { items: [] };

  private activeConfig?: MentionConfig;

  private DEFAULT_CONFIG: MentionConfig = {
    items: [],
    triggerChar: '@',
    labelKey: 'label',
    maxItems: -1,
    allowSpace: false,
    returnTrigger: false,
    mentionSelect: (item: MentionItem | string, triggerChar?: string) => {
      // Add defensive null/undefined checks to prevent TypeError
      if (!item) {
        Log.warn('MentionDirective: mentionSelect called with undefined/null item');
        return this.activeConfig?.triggerChar || '';
      }

      // Handle string items directly
      if (typeof item === 'string') {
        return (this.activeConfig?.triggerChar || '') + item;
      }

      // Handle MentionItem objects
      const labelKey = this.activeConfig?.labelKey || 'label';
      const itemValue = item[labelKey];

      if (itemValue === undefined || itemValue === null) {
        Log.warn(`MentionDirective: item missing required property '${labelKey}'`, item);
        return this.activeConfig?.triggerChar || '';
      }

      return (this.activeConfig?.triggerChar || '') + itemValue + ' ';
    },
    mentionFilter: (searchString: string, items?: MentionItem[] | string[]) => {
      if (!items || !Array.isArray(items)) {
        Log.warn('MentionDirective: mentionFilter called with invalid items array');
        return [];
      }

      const searchStringLowerCase = searchString.toLowerCase();
      const labelKey = this.activeConfig?.labelKey || 'label';

      const filteredItems = items.filter((e: MentionItem | string) => {
        // Add defensive checks to prevent errors during filtering
        if (!e) {
          return false;
        }

        // Handle string items directly
        if (typeof e === 'string') {
          return e.toLowerCase().startsWith(searchStringLowerCase);
        }

        // Handle MentionItem objects
        if (typeof e === 'object') {
          const itemValue = e[labelKey];
          if (
            itemValue === undefined ||
            itemValue === null ||
            typeof itemValue !== 'string'
          ) {
            return false;
          }
          return itemValue.toLowerCase().startsWith(searchStringLowerCase);
        }

        return false;
      });

      // Return the same type as the input array
      return filteredItems as typeof items;
    },
  };

  // template to use for rendering list items
  @Input() mentionListTemplate?: TemplateRef<{ $implicit: MentionItem; index: number }>;

  // event emitted whenever the search term changes
  @Output() searchTerm = new EventEmitter<string>();

  // event emitted when an item is selected
  @Output() itemSelected = new EventEmitter<MentionItem | string>();

  // event emitted whenever the mention list is opened or closed
  @Output() opened = new EventEmitter();
  @Output() closed = new EventEmitter();
  listShownChange = output<boolean>();

  private triggerChars: { [key: string]: MentionConfig } = {};

  private searchString: string | null = null;
  private startPos: number = -1;
  private startNode: MentionNode = null;
  private searchList?: MentionListComponent;
  private searching: boolean = false;
  private iframe: HTMLIFrameElement | null = null; // optional
  private lastKeyCode: number = 0;

  private readonly _element = inject(ElementRef);
  private readonly _componentResolver = inject(ComponentFactoryResolver);
  private readonly _viewContainerRef = inject(ViewContainerRef);

  ngOnChanges(changes: SimpleChanges): void {
    // console.log('config change', changes);
    if (changes['mention'] || changes['mentionConfig']) {
      this.updateConfig();
    }
  }

  public updateConfig(): void {
    const config = this.mentionConfig;
    this.triggerChars = {};
    // use items from directive if they have been set
    if (this.mentionItems) {
      config.items = this.mentionItems;
    }
    this.addConfig(config);
    // nested configs
    if (config.mentions) {
      config.mentions.forEach((nestedConfig) => this.addConfig(nestedConfig));
    }
  }

  // add configuration for a trigger char
  private addConfig(cfg: MentionConfig): void {
    // defaults
    const defaults = Object.assign({}, this.DEFAULT_CONFIG);
    const config = Object.assign(defaults, cfg);
    // items
    let items = config.items;
    if (items && items.length > 0) {
      // convert strings to objects
      if (typeof items[0] == 'string') {
        items = (items as string[]).map((label) => {
          const object: MentionItem = {};
          object[config.labelKey || 'label'] = label;
          return object;
        });
      }
      if (config.labelKey) {
        // remove items without an labelKey (as it's required to filter the list)
        items = (items as MentionItem[]).filter((e) => e[config.labelKey!]);
        if (!config.disableSort) {
          (items as MentionItem[]).sort((a, b) =>
            String(a[config.labelKey!]).localeCompare(String(b[config.labelKey!])),
          );
        }
      }
    }
    config.items = items;

    // add the config
    this.triggerChars[config.triggerChar || '@'] = config;

    // for async update while menu/search is active
    if (this.activeConfig && this.activeConfig.triggerChar == config.triggerChar) {
      this.activeConfig = config;
      this.updateSearchList();
    }
  }

  setIframe(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;
  }

  stopEvent(event: MentionEvent | null): void {
    // Handle null or undefined events gracefully
    if (!event) {
      return;
    }
    //if (event instanceof KeyboardEvent) { // does not work for iframe
    if (!event.wasClick) {
      // Add defensive checks to ensure methods exist before calling them
      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      if (typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    }
  }

  blurHandler(event: MentionEvent): void {
    this.stopEvent(event);
    this.stopSearch();
  }

  inputHandler(
    event: MentionEvent,
    nativeElement: TextInputElement = this._element.nativeElement,
  ): void {
    if (this.lastKeyCode === KEY_BUFFERED && event.data) {
      const keyCode = event.data.charCodeAt(0);
      this.keyHandler(
        { keyCode, inputEvent: true } as CustomKeyboardEvent,
        nativeElement,
      );
    }
  }

  // @param nativeElement is the alternative text element in an iframe scenario
  keyHandler(
    event: MentionEvent,
    nativeElement: TextInputElement = this._element.nativeElement,
  ): boolean | undefined {
    this.lastKeyCode = event.keyCode || 0;

    if (event.isComposing || event.keyCode === KEY_BUFFERED) {
      return undefined;
    }

    const val: string | null = getValue(nativeElement);
    let pos = getCaretPosition(nativeElement, this.iframe);

    if (val === null) {
      return undefined;
    }
    let charPressed = event.key;
    if (!charPressed) {
      const charCode = event.which || event.keyCode || 0;
      if (!event.shiftKey && charCode >= 65 && charCode <= 90) {
        charPressed = String.fromCharCode(charCode + 32);
      }
      // else if (event.shiftKey && charCode === KEY_2) {
      //   charPressed = this.config.triggerChar;
      // }
      else {
        // TODO (dmacfarlane) fix this for non-alpha keys
        // http://stackoverflow.com/questions/2220196/how-to-decode-character-pressed-from-jquerys-keydowns-event-handler?lq=1
        charPressed = String.fromCharCode((event.which || event.keyCode) ?? 0);
      }
    }
    if (event.keyCode == KEY_ENTER && event.wasClick && pos < this.startPos) {
      // Restore caret near where it should be when a list item was clicked.
      // Compute end position based on typed search length instead of relying on DOM nodes.
      const typedLen = 1 + (this.searchString ? this.searchString.length : 0); // trigger + search
      pos = this.startPos + typedLen;
      setCaretPosition(
        isInputOrTextAreaElement(nativeElement)
          ? nativeElement
          : (this.startNode as HTMLInputElement | HTMLTextAreaElement),
        pos,
        this.iframe,
      );
    }
    //console.log("keyHandler", this.startPos, pos, val, charPressed, event);

    const config = this.triggerChars[charPressed];
    if (config) {
      this.activeConfig = config;
      this.startPos = event.inputEvent ? pos - 1 : pos;
      const selection = this.iframe
        ? this.iframe.contentWindow?.getSelection()
        : window.getSelection();
      this.startNode = selection?.anchorNode || null;
      this.searching = true;
      this.searchString = null;
      this.showSearchList(nativeElement);
      this.updateSearchList();

      if (config.returnTrigger) {
        this.searchTerm.emit(config.triggerChar);
      }
    } else if (this.startPos >= 0 && this.searching) {
      if (pos <= this.startPos && this.searchList) {
        // Caret moved before the trigger char; terminate search cleanly
        this.stopSearch();
      }
      // ignore shift when pressed alone, but not when used with another key
      else if (
        event.keyCode !== KEY_SHIFT &&
        !event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        pos > this.startPos
      ) {
        if (!this.activeConfig!.allowSpace && event.keyCode === KEY_SPACE) {
          this.startPos = -1;
        } else if (event.keyCode === KEY_BACKSPACE && pos > 0) {
          const newPos = pos - 1;
          if (newPos == this.startPos) {
            this.stopSearch();
          }
        } else if (this.searchList && this.searchList.hidden) {
          if (event.keyCode === KEY_TAB || event.keyCode === KEY_ENTER) {
            this.stopSearch();
            return undefined;
          }
        } else if (this.searchList && !this.searchList.hidden) {
          if (event.keyCode === KEY_TAB || event.keyCode === KEY_ENTER) {
            this.stopEvent(event);

            // Check if we have a valid active item before proceeding
            if (!this.searchList.activeItem) {
              console.warn('MentionDirective: No active item available for selection');
              this.stopSearch();
              return false;
            }

            // emit the selected list item
            const activeItem = this.searchList.activeItem;
            if (activeItem) {
              this.itemSelected.emit(activeItem);
              // optional function to format the selected item before inserting the text
              const text = this.activeConfig!.mentionSelect!(
                activeItem as MentionItem | string,
                this.activeConfig!.triggerChar,
              );
              // value is inserted without a trailing space for consistency
              // between element types (div and iframe do not preserve the space)
              insertValue(nativeElement, this.startPos, pos, text, this.iframe);
              // fire input event so angular bindings are updated
              if ('createEvent' in document) {
                const evt = document.createEvent('HTMLEvents');
                if (this.iframe) {
                  // a 'change' event is required to trigger tinymce updates
                  evt.initEvent('change', true, false);
                } else {
                  evt.initEvent('input', true, false);
                }
                // this seems backwards, but fire the event from this elements nativeElement (not the
                // one provided that may be in an iframe, as it won't be propogate)
                this._element.nativeElement.dispatchEvent(evt);
              }
              this.startPos = -1;
              this.stopSearch();
              return false;
            }
          } else if (event.keyCode === KEY_ESCAPE) {
            this.stopEvent(event);
            this.stopSearch();
            return false;
          } else if (event.keyCode === KEY_DOWN) {
            this.stopEvent(event);
            this.searchList!.activateNextItem();
            return false;
          } else if (event.keyCode === KEY_UP) {
            this.stopEvent(event);
            this.searchList!.activatePreviousItem();
            return false;
          }
        }

        if (charPressed.length != 1 && event.keyCode != KEY_BACKSPACE) {
          this.stopEvent(event);
          return false;
        } else if (this.searching) {
          let mention = val.substring(this.startPos + 1, pos);
          if (event.keyCode !== KEY_BACKSPACE && !event.inputEvent) {
            mention += charPressed;
          }
          this.searchString = mention;
          if (this.activeConfig!.returnTrigger) {
            const triggerChar =
              this.searchString || event.keyCode === KEY_BACKSPACE
                ? val.substring(this.startPos, this.startPos + 1)
                : '';
            this.searchTerm.emit(triggerChar + this.searchString);
          } else {
            this.searchTerm.emit(this.searchString);
          }
          this.updateSearchList();
        }
      }
    }
    return undefined;
  }

  // exposed for external calls to open the mention list, e.g. by clicking a button
  public startSearch(
    triggerChar?: string,
    nativeElement: TextInputElement = this._element.nativeElement,
  ): void {
    triggerChar =
      triggerChar ||
      this.mentionConfig.triggerChar ||
      this.DEFAULT_CONFIG.triggerChar ||
      '@';
    const pos = getCaretPosition(nativeElement, this.iframe);
    insertValue(nativeElement, pos, pos, triggerChar, this.iframe);
    this.keyHandler(
      { key: triggerChar, inputEvent: true } as CustomKeyboardEvent,
      nativeElement,
    );
  }

  stopSearch(): void {
    if (this.searchList && !this.searchList.hidden) {
      this.searchList.hidden = true;
      this.closed.emit();
      this.listShownChange.emit(false);
    }
    this.activeConfig = undefined;
    this.searching = false;
  }

  updateSearchList(): void {
    let matches: MentionItem[] | string[] = [];
    if (this.activeConfig && this.activeConfig.items) {
      let objects = this.activeConfig.items;
      // disabling the search relies on the async operation to do the filtering
      if (
        !this.activeConfig.disableSearch &&
        this.searchString &&
        this.activeConfig.labelKey
      ) {
        if (this.activeConfig.mentionFilter) {
          objects = this.activeConfig.mentionFilter(this.searchString, objects);
        }
      }
      matches = objects;
      if (
        this.activeConfig &&
        this.activeConfig.maxItems &&
        this.activeConfig.maxItems > 0
      ) {
        matches = matches.slice(0, this.activeConfig.maxItems);
      }
    }
    // update the search list
    if (this.searchList) {
      this.searchList.items = matches;
      this.searchList.hidden = matches.length == 0;
      this.listShownChange.emit(matches.length > 0);
    }
  }

  showSearchList(nativeElement: TextInputElement): void {
    this.opened.emit();
    this.listShownChange.emit(true);

    if (this.searchList == null) {
      const componentFactory =
        this._componentResolver.resolveComponentFactory(MentionListComponent);
      const componentRef = this._viewContainerRef.createComponent(componentFactory);
      this.searchList = componentRef.instance;
      this.searchList.itemTemplate = this.mentionListTemplate;
      componentRef.instance['itemClick'].subscribe(() => {
        nativeElement.focus();
        const fakeKeydown = {
          key: 'Enter',
          keyCode: KEY_ENTER,
          wasClick: true,
        } as CustomKeyboardEvent;
        this.keyHandler(fakeKeydown, nativeElement);
      });
    }
    this.searchList.labelKey = this.activeConfig!.labelKey || 'label';
    this.searchList.dropUp = this.activeConfig!.dropUp || false;
    this.searchList.styleOff = this.mentionConfig.disableStyle || false;
    this.searchList.activeIndex = 0;
    this.searchList.position(nativeElement as HTMLInputElement, this.iframe);
    if (this.searchList) {
      window.requestAnimationFrame(() => this.searchList!.reset());
    }
  }
}
