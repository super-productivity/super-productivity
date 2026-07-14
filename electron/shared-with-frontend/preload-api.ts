import { IPC, IPCEventValue } from './ipc-events.const';
import {
  JiraCapabilityEnvelope,
  JiraElectronApi,
  JiraElectronResponse,
} from './jira-request.model';
import { createOneShotApiConsumer } from './one-shot-api-consumer';

type Invoke = (channel: IPCEventValue, ...args: unknown[]) => Promise<unknown>;
type PayloadListener = (...args: unknown[]) => void;

export const toPayloadOnlyIpcListener =
  (listener: PayloadListener) =>
  (_event: unknown, ...args: unknown[]): void =>
    listener(...args);

export const createJiraPreloadApiConsumer = (
  invoke: Invoke,
): (() => JiraElectronApi | null) => {
  // Register before renderer code runs. The token remains inside this isolated
  // preload closure and is never exposed through the context bridge.
  const capabilityTokenPromise = invoke(IPC.JIRA_REGISTER_CAPABILITY).then((token) =>
    typeof token === 'string' && token.length > 0 ? token : null,
  );

  const invokeWithCapability = async <TResponse, TPayload>(
    channel: IPCEventValue,
    payload: TPayload,
  ): Promise<TResponse> => {
    const capabilityToken = await capabilityTokenPromise;
    if (!capabilityToken) {
      throw new Error('Jira Electron API is unavailable');
    }
    const envelope: JiraCapabilityEnvelope<TPayload> = {
      capabilityToken,
      payload,
    };
    return invoke(channel, envelope) as Promise<TResponse>;
  };

  return createOneShotApiConsumer<JiraElectronApi>(() => ({
    makeRequest: (request) =>
      invokeWithCapability<JiraElectronResponse, typeof request>(
        IPC.JIRA_MAKE_REQUEST_EVENT,
        request,
      ),
    setupImgHeaders: (config) =>
      invokeWithCapability<void, typeof config>(IPC.JIRA_SETUP_IMG_HEADERS, config),
    clearImgHeaders: () =>
      invokeWithCapability<void, null>(IPC.JIRA_CLEAR_IMG_HEADERS, null),
  }));
};
