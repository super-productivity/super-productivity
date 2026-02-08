// DOM element manipulation functions...
//

import { TextInputElement } from './mention-types';

const setValue = (el: TextInputElement, value: string): void => {
  //console.log("setValue", el.nodeName, "["+value+"]");
  if (isInputOrTextAreaElement(el)) {
    el.value = value;
  } else {
    el.textContent = value;
  }
};

export const getValue = (el: TextInputElement): string | null => {
  return isInputOrTextAreaElement(el) ? el.value : el.textContent;
};

export const insertValue = (
  el: TextInputElement,
  start: number,
  end: number,
  text: string,
  iframe: HTMLIFrameElement | null,
  noRecursion: boolean = false,
): void => {
  //console.log("insertValue", el.nodeName, start, end, "["+text+"]", el);
  if (isTextElement(el)) {
    const val = getValue(el);
    if (val !== null) {
      setValue(el, val.substring(0, start) + text + val.substring(end, val.length));
      setCaretPosition(el, start + text.length, iframe);
    }
  } else if (!noRecursion) {
    const selObj = getWindowSelection(iframe);
    if (selObj && selObj.rangeCount > 0) {
      const selRange = selObj.getRangeAt(0);
      const position = selRange.startOffset;
      const anchorNode = selObj.anchorNode;
      // if (text.endsWith(' ')) {
      //   text = text.substring(0, text.length-1) + '\xA0';
      // }
      if (anchorNode) {
        insertValue(
          anchorNode as TextInputElement,
          position - (end - start),
          position,
          text,
          iframe,
          true,
        );
      }
    }
  }
};

export const isInputOrTextAreaElement = (el: HTMLElement): boolean => {
  return el != null && (el.nodeName == 'INPUT' || el.nodeName == 'TEXTAREA');
};

export const isTextElement = (el: HTMLElement): boolean => {
  return (
    el != null &&
    (el.nodeName == 'INPUT' || el.nodeName == 'TEXTAREA' || el.nodeName == '#text')
  );
};

export const setCaretPosition = (
  el: TextInputElement,
  pos: number,
  iframe: HTMLIFrameElement | null = null,
): void => {
  //console.log("setCaretPosition", pos, el, iframe==null);
  // selectionStart can be 0; check for number explicitly
  if (isInputOrTextAreaElement(el) && typeof el.selectionStart === 'number') {
    el.focus();
    el.setSelectionRange(pos, pos);
  } else {
    const range = getDocument(iframe).createRange();
    range.setStart(el, pos);
    range.collapse(true);
    const sel = getWindowSelection(iframe);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
};

export const getCaretPosition = (
  el: TextInputElement,
  iframe: HTMLIFrameElement | null = null,
): number => {
  //console.log("getCaretPosition", el);
  if (isInputOrTextAreaElement(el)) {
    const val = el.value;
    return val.slice(0, el.selectionStart || 0).length;
  } else {
    const selObj = getWindowSelection(iframe); //window.getSelection();
    if (selObj && selObj.rangeCount > 0) {
      const selRange = selObj.getRangeAt(0);
      const preCaretRange = selRange.cloneRange();
      preCaretRange.selectNodeContents(el);
      preCaretRange.setEnd(selRange.endContainer, selRange.endOffset);
      const position = preCaretRange.toString().length;
      return position;
    }
    return 0;
  }
};

// Based on ment.io functions...
//

const getDocument = (iframe: HTMLIFrameElement | null): Document => {
  if (!iframe) {
    return document;
  } else {
    return iframe.contentWindow?.document || document;
  }
};

const getWindowSelection = (iframe: HTMLIFrameElement | null): Selection | null => {
  if (!iframe) {
    return window.getSelection();
  } else {
    return iframe.contentWindow?.getSelection() || null;
  }
};

export const getContentEditableCaretCoords = (ctx: {
  iframe: HTMLIFrameElement | null;
  parent?: Element | null;
}): { left: number; top: number } => {
  const markerTextChar = '\ufeff';
  const markerId =
    'sel_' + new Date().getTime() + '_' + Math.random().toString().slice(2);
  const doc = getDocument(ctx ? ctx.iframe : null);
  const sel = getWindowSelection(ctx ? ctx.iframe : null);
  if (!sel || sel.rangeCount === 0) {
    return { left: 0, top: 0 };
  }

  const prevRange = sel.getRangeAt(0);

  // create new range and set postion using prevRange
  const range = doc.createRange();
  if (sel.anchorNode) {
    range.setStart(sel.anchorNode, prevRange.startOffset);
    range.setEnd(sel.anchorNode, prevRange.startOffset);
    range.collapse(false);

    // Create the marker element containing a single invisible character
    // using DOM methods and insert it at the position in the range
    const markerEl = doc.createElement('span');
    markerEl.id = markerId;
    markerEl.appendChild(doc.createTextNode(markerTextChar));
    range.insertNode(markerEl);
    sel.removeAllRanges();
    sel.addRange(prevRange);

    const coordinates = {
      left: 0,
      top: markerEl.offsetHeight,
    };

    localToRelativeCoordinates(ctx, markerEl, coordinates);

    if (markerEl.parentNode) {
      markerEl.parentNode.removeChild(markerEl);
    }
    return coordinates;
  }
  return { left: 0, top: 0 };
};

const localToRelativeCoordinates = (
  ctx: { iframe: HTMLIFrameElement | null; parent?: Element | null },
  element: Element,
  coordinates: { top: number; left: number },
): void => {
  let obj = <HTMLElement>element;
  let iframe = ctx ? ctx.iframe : null;
  while (obj) {
    if (ctx.parent != null && ctx.parent == obj) {
      break;
    }
    coordinates.left += obj.offsetLeft + obj.clientLeft;
    coordinates.top += obj.offsetTop + obj.clientTop;
    obj = <HTMLElement>obj.offsetParent;
    if (!obj && iframe) {
      obj = iframe;
      iframe = null;
    }
  }
  obj = <HTMLElement>element;
  iframe = ctx ? ctx.iframe : null;
  while (obj !== getDocument(null).body && obj != null) {
    if (ctx.parent != null && ctx.parent == obj) {
      break;
    }
    if (obj.scrollTop && obj.scrollTop > 0) {
      coordinates.top -= obj.scrollTop;
    }
    if (obj.scrollLeft && obj.scrollLeft > 0) {
      coordinates.left -= obj.scrollLeft;
    }
    obj = <HTMLElement>obj.parentNode;
    if (!obj && iframe) {
      obj = iframe;
      iframe = null;
    }
  }
};
