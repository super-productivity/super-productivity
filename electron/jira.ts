import { getWin } from './main-window';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { session } from 'electron';
import { JiraCfg } from '../src/app/features/issue/providers/jira/jira.model';
import fetch, { RequestInit } from 'node-fetch';
import { Agent } from 'https';
import { error, log } from 'electron-log/main';

export const sendJiraRequest = ({
  requestId,
  requestInit,
  url,
  jiraCfg,
}: {
  requestId: string;
  requestInit: RequestInit;
  url: string;
  jiraCfg: JiraCfg;
}): void => {
  const mainWin = getWin();
  // log('--------------------------------------------------------------------');
  // log(url);
  // log('--------------------------------------------------------------------');
  fetch(url, {
    ...requestInit,
    // Allow self-signed certificates for self-hosted Jira instances.
    // This is an intentional user-configurable setting (isAllowSelfSignedCertificate).
    // CodeQL alert js/disabling-certificate-validation is expected here.
    ...(jiraCfg && jiraCfg.isAllowSelfSignedCertificate
      ? {
          agent: new Agent({
            rejectUnauthorized: false, // lgtm[js/disabling-certificate-validation]
          }),
        }
      : {}),
  } as RequestInit)
    .then(async (response) => {
      // log('JIRA_RAW_RESPONSE', response);
      if (!response.ok) {
        error('Jira Error Error Response ELECTRON: ', response);
        try {
          log(JSON.stringify(response));
        } catch (e) {}

        let errText;
        try {
          errText = await response.text();
        } catch (e2) {
          throw Error(response.statusText);
        }
        throw Error(errText || response.statusText);
      }
      return response;
    })
    .then((res) => res.text())
    .then((text) => {
      try {
        return text ? JSON.parse(text) : {};
      } catch (e) {
        console.error('Error: Cannot parse json');
        console.log('Error: text response', text);
        // throw new Error(e);
        return text;
      }
    })
    .then((response) => {
      mainWin.webContents.send(IPC.JIRA_CB_EVENT, {
        response,
        requestId,
      });
    })
    .catch((err: unknown) => {
      mainWin.webContents.send(IPC.JIRA_CB_EVENT, {
        error: err,
        requestId,
      });
    });
};

// TODO simplify and do encoding in frontend service
export const setupRequestHeadersForImages = (jiraCfg: JiraCfg): void => {
  const { host, protocol } = parseHostAndPort(jiraCfg);

  // TODO export to util fn
  const _b64EncodeUnicode = (str: string): string => {
    return Buffer.from(str || '').toString('base64');
  };
  const encoded = _b64EncodeUnicode(`${jiraCfg.userName}:${jiraCfg.password}`);
  const filter = {
    urls: [`${protocol}://${host}/*`],
  };

  // thankfully only the last attached listener will be used
  // @see: https://electronjs.org/docs/api/web-request
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (jiraCfg.usePAT) {
      details.requestHeaders.authorization = `Bearer ${jiraCfg.password}`;
    } else {
      details.requestHeaders.authorization = `Basic ${encoded}`;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
};

const MATCH_PROTOCOL_REG_EX = /(^[^:]+):\/\//;
const MATCH_PORT_REG_EX = /:\d{2,4}/;

const parseHostAndPort = (
  config: JiraCfg,
): { host: string; protocol: string; port: number | undefined } => {
  let host: string = config.host as string;
  let protocol;
  let port;

  if (!host) {
    throw new Error('No host given');
  }

  // parse port from host and remove it
  if (host.match(MATCH_PORT_REG_EX)) {
    const match = MATCH_PORT_REG_EX.exec(host) as RegExpExecArray;
    host = host.replace(MATCH_PORT_REG_EX, '');
    port = parseInt(match[0].replace(':', ''), 10);
  }

  // parse protocol from host and remove it
  if (host.match(MATCH_PROTOCOL_REG_EX)) {
    const match = MATCH_PROTOCOL_REG_EX.exec(host);
    host = host
      .replace(MATCH_PROTOCOL_REG_EX, '')
      // remove trailing slash just in case
      .replace(/\/$/, '');

    protocol = (match as any)[1];
  } else {
    protocol = 'https';
  }

  // log({host, protocol, port});
  return { host, protocol, port };
};
