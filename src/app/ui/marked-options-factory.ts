import { MarkedOptions, MarkedRenderer } from 'ngx-markdown';

export const markedOptionsFactory = (): MarkedOptions => {
  const renderer = new MarkedRenderer();

  renderer.checkbox = ({ checked }: { checked: boolean }) =>
    `<span class="checkbox material-icons">${checked ? 'check_box' : 'check_box_outline_blank'}</span>`;

  renderer.listitem = ({
    text,
    task,
    checked,
  }: {
    text: string;
    task: boolean;
    checked?: boolean;
  }) => {
    // In marked v17, task list items need to manually prepend the checkbox
    if (task) {
      const isChecked = checked === true;
      const checkboxHtml = `<span class="checkbox material-icons">${isChecked ? 'check_box' : 'check_box_outline_blank'}</span>`;
      return `<li class="checkbox-wrapper ${isChecked ? 'done' : 'undone'}">${checkboxHtml}${text}</li>`;
    }
    return `<li>${text}</li>`;
  };

  renderer.link = ({ href, title, text }) =>
    `<a target="_blank" href="${href}" title="${title || ''}">${text}</a>`;

  renderer.paragraph = ({ text }) => {
    const split = text.split('\n');
    return split.reduce((acc, p, i) => {
      const result = /h(\d)\./.exec(p);
      if (result !== null) {
        const h = `h${result[1]}`;
        return acc + `<${h}>${p.replace(result[0], '')}</${h}>`;
      }

      if (split.length === 1) {
        return `<p>` + p + `</p>`;
      }

      return acc ? (split.length - 1 === i ? acc + p + `</p>` : acc + p) : `<p>` + p;
    }, '');
  };

  // parse all RFC3986 URIs
  const urlPattern =
    /\b((([A-Za-z][A-Za-z0-9+.-]*):\/\/([^\/?#]*))([^?#]*)(\?([^#]*))?(#(.*))?)\b/gi;

  const rendererTxtOld = renderer.text.bind(renderer);
  renderer.text = (token) => {
    const modifiedToken = {
      ...token,
      text: token.text.replace(urlPattern, (url) => {
        return `<a href="${url}" target="_blank">${url}</a>`;
      }),
    };
    return rendererTxtOld(modifiedToken);
  };

  return {
    renderer,
    gfm: true,
    breaks: false,
    pedantic: false,
  };
};
