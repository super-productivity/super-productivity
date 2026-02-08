/* From: https://github.com/component/textarea-caret-position */
/* jshint browser: true */

// (function () {

// We'll copy the properties below into the mirror div.
// Note that some browsers, such as Firefox, do not concatenate properties
// into their shorthand (e.g. padding-top, padding-bottom etc. -> padding),
// so we have to list every single property explicitly.
const properties = [
  'direction', // RTL support
  'boxSizing',
  'width', // on Chrome and IE, exclude the scrollbar, so the mirror div wraps exactly as the textarea does
  'height',
  'overflowX',
  'overflowY', // copy the scrollbar for IE

  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',

  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',

  // https://developer.mozilla.org/en-US/docs/Web/CSS/font
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',

  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration', // might not make a difference, but better be safe

  'letterSpacing',
  'wordSpacing',

  'tabSize',
  'MozTabSize',
];

const isBrowser = typeof window !== 'undefined';
const isFirefox = isBrowser && window['mozInnerScreenX'] != null;

interface CaretCoordinatesOptions {
  debug?: boolean;
}

interface CaretCoordinates {
  top: number;
  left: number;
  height: number;
}

export const getCaretCoordinates = (
  element: HTMLTextAreaElement | HTMLInputElement,
  position: number,
  options?: CaretCoordinatesOptions,
): CaretCoordinates => {
  if (!isBrowser) {
    throw new Error(
      'textarea-caret-position#getCaretCoordinates should only be called in a browser',
    );
  }

  const debug = (options && options.debug) || false;
  if (debug) {
    const el = document.querySelector('#input-textarea-caret-position-mirror-div');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // The mirror div will replicate the textarea's style
  const div = document.createElement('div');
  div.id = 'input-textarea-caret-position-mirror-div';
  document.body.appendChild(div);

  const style = div.style;
  const computed = window.getComputedStyle
    ? window.getComputedStyle(element)
    : (element as any).currentStyle; // currentStyle for IE < 9
  const isInput = element.nodeName === 'INPUT';

  // Default textarea styles
  style.whiteSpace = 'pre-wrap';
  if (!isInput) style.wordWrap = 'break-word'; // only for textarea-s

  // Position off-screen
  style.position = 'absolute'; // required to return coordinates properly
  if (!debug) style.visibility = 'hidden'; // not 'display: none' because we want rendering

  // Transfer the element's properties to the div
  properties.forEach((prop) => {
    if (isInput && prop === 'lineHeight') {
      // Special case for <input>s because text is rendered centered and line height may be != height
      if (computed.boxSizing === 'border-box') {
        const height = parseInt(computed.height, 10);
        const outerHeight =
          parseInt(computed.paddingTop, 10) +
          parseInt(computed.paddingBottom, 10) +
          parseInt(computed.borderTopWidth, 10) +
          parseInt(computed.borderBottomWidth, 10);
        const targetHeight = outerHeight + parseInt(computed.lineHeight, 10);
        if (height > targetHeight) {
          style.lineHeight = height - outerHeight + 'px';
        } else if (height === targetHeight) {
          style.lineHeight = computed.lineHeight;
        } else {
          style.lineHeight = '0';
        }
      } else {
        style.lineHeight = computed.height;
      }
    } else {
      style[prop] = computed[prop];
    }
  });

  if (isFirefox) {
    // Firefox lies about the overflow property for textareas: https://bugzilla.mozilla.org/show_bug.cgi?id=984275
    if (element.scrollHeight > parseInt(computed.height, 10)) style.overflowY = 'scroll';
  } else {
    style.overflow = 'hidden'; // for Chrome to not render a scrollbar; IE keeps overflowY = 'scroll'
  }

  div.textContent = element.value.substring(0, position);
  // The second special handling for input type="text" vs textarea:
  // spaces need to be replaced with non-breaking spaces - http://stackoverflow.com/a/13402035/1269037
  if (isInput && div.textContent) {
    div.textContent = div.textContent.replace(/\s/g, '\u00a0');
  }

  const span = document.createElement('span');
  // Wrapping must be replicated *exactly*, including when a long word gets
  // onto the next line, with whitespace at the end of the line before (#7).
  // The  *only* reliable way to do that is to copy the *entire* rest of the
  // textarea's content into the <span> created at the caret position.
  // For inputs, just '.' would be enough, but no need to bother.
  span.textContent = element.value.substring(position) || '.'; // || because a completely empty faux span doesn't render at all
  div.appendChild(span);

  const coordinates = {
    top: span.offsetTop + parseInt(computed['borderTopWidth'], 10),
    left: span.offsetLeft + parseInt(computed['borderLeftWidth'], 10),
    height: parseInt(computed['lineHeight'], 10),
  };

  if (debug) {
    span.style.backgroundColor = '#aaa';
  } else {
    document.body.removeChild(div);
  }

  return coordinates;
};

// if (typeof module != 'undefined' && typeof module.exports != 'undefined') {
//   module.exports = getCaretCoordinates;
// } else if(isBrowser) {
//   window.getCaretCoordinates = getCaretCoordinates;
// }

// }());
