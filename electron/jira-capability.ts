import { randomBytes } from 'node:crypto';
import { JiraCapabilityEnvelope } from './shared-with-frontend/jira-request.model';

const TOKEN_BYTES = 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class JiraCapabilityRegistry {
  private readonly _tokens = new WeakMap<object, string>();

  constructor(
    private readonly _createToken: () => string = () =>
      randomBytes(TOKEN_BYTES).toString('base64url'),
  ) {}

  register(frame: object): string | null {
    if (this._tokens.has(frame)) {
      return null;
    }

    const token = this._createToken();
    this._tokens.set(frame, token);
    return token;
  }

  isAuthorized(frame: object, token: unknown): token is string {
    return typeof token === 'string' && this._tokens.get(frame) === token;
  }

  unwrap<T>(frame: object, envelope: unknown): T {
    if (
      !isRecord(envelope) ||
      !this.isAuthorized(frame, envelope.capabilityToken) ||
      !Object.prototype.hasOwnProperty.call(envelope, 'payload')
    ) {
      throw new Error('Unauthorized Jira IPC request');
    }

    return (envelope as unknown as JiraCapabilityEnvelope<T>).payload;
  }
}
