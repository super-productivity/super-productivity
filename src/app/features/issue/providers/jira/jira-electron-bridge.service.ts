import { Injectable } from '@angular/core';
import { IS_ELECTRON } from '../../../../app.constants';
import {
  JiraElectronApi,
  JiraElectronRequest,
  JiraElectronResponse,
  JiraImageAuthConfig,
} from '../../../../../../electron/shared-with-frontend/jira-request.model';

@Injectable({ providedIn: 'root' })
export class JiraElectronBridgeService {
  #api: JiraElectronApi | null | undefined;

  initialize(): void {
    if (this.#api !== undefined) {
      return;
    }

    // Claim the one-shot capability during trusted app startup, before plugin
    // code is loaded into the renderer.
    this.#api = IS_ELECTRON ? window.ea.consumeJiraApi() : null;
  }

  makeRequest(request: JiraElectronRequest): Promise<JiraElectronResponse> {
    this.initialize();
    if (!this.#api) {
      return Promise.reject(new Error('Jira Electron API is unavailable'));
    }
    return this.#api.makeRequest(request);
  }

  setupImgHeaders(config: JiraImageAuthConfig): Promise<void> {
    this.initialize();
    return this.#api ? this.#api.setupImgHeaders(config) : Promise.resolve();
  }
}
