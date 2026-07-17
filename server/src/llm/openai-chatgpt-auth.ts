import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  ModelProviderLoginStartResponse,
  ModelProviderStatus,
} from '../../../shared/agent-contracts';

const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const authorizeUrl = 'https://auth.openai.com/oauth/authorize';
const tokenUrl = 'https://auth.openai.com/oauth/token';
const defaultCallbackPort = 1455;
const scope = 'openid profile email offline_access';
const refreshThresholdMs = 60_000;
const loginTimeoutMs = 10 * 60_000;

export const codexResponsesBaseUrl = 'https://chatgpt.com/backend-api/codex';

export interface OpenAiChatGptTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId: string;
  readonly email?: string;
  readonly plan?: string;
}

interface PendingLogin {
  readonly authorizationUrl: string;
  readonly ready: Promise<void>;
  readonly completion: Promise<OpenAiChatGptTokens>;
  readonly cancel: () => void;
}

export interface OpenAiChatGptAuthServiceOptions {
  readonly callbackPort?: number;
  readonly exchangeAuthorizationCode?: (
    code: string,
    verifier: string,
    redirectUri: string,
  ) => Promise<OpenAiChatGptTokens>;
}

export class OpenAiChatGptAuthService {
  private readonly credentialsPath: string;
  private readonly callbackPort: number;
  private readonly redirectUri: string;
  private readonly exchangeAuthorizationCodeImplementation: (
    code: string,
    verifier: string,
    redirectUri: string,
  ) => Promise<OpenAiChatGptTokens>;
  private pendingLogin?: PendingLogin;
  private refreshPromise?: Promise<OpenAiChatGptTokens>;
  private lastError?: string;

  constructor(dataDir: string, options: OpenAiChatGptAuthServiceOptions = {}) {
    this.credentialsPath = join(dataDir, 'provider-auth', 'openai-chatgpt.json');
    this.callbackPort = options.callbackPort ?? defaultCallbackPort;
    this.redirectUri = `http://localhost:${this.callbackPort}/auth/callback`;
    this.exchangeAuthorizationCodeImplementation =
      options.exchangeAuthorizationCode ?? exchangeAuthorizationCode;
  }

  async status(): Promise<ModelProviderStatus> {
    const tokens = await this.readTokens();

    return {
      id: 'openai-chatgpt',
      label: 'OpenAI (ChatGPT login)',
      authMethod: 'oauth',
      authenticated: Boolean(tokens),
      experimental: true,
      loginPending: Boolean(this.pendingLogin),
      ...(tokens?.email ? { account: formatAccount(tokens.email, tokens.plan) } : {}),
      ...(tokens ? { expiresAt: new Date(tokens.expiresAt).toISOString() } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  async startLogin(): Promise<ModelProviderLoginStartResponse> {
    let pending = this.pendingLogin;

    if (!pending) {
      this.lastError = undefined;
      pending = this.createLogin();
      this.pendingLogin = pending;
      void pending.completion
        .then(() => {
          this.lastError = undefined;
        })
        .catch((error: unknown) => {
          this.lastError = safeErrorMessage(error);
        })
        .finally(() => {
          if (this.pendingLogin === pending) this.pendingLogin = undefined;
        });
    }

    await pending.ready;

    return {
      provider: 'openai-chatgpt',
      authorizationUrl: pending.authorizationUrl,
    };
  }

  async loginAndWait(openUrl: (url: string) => void): Promise<ModelProviderStatus> {
    const login = await this.startLogin();
    openUrl(login.authorizationUrl);
    const pending = this.pendingLogin;

    if (!pending) {
      throw new Error('ChatGPT login could not be started.');
    }

    await pending.completion;
    this.lastError = undefined;
    if (this.pendingLogin === pending) this.pendingLogin = undefined;

    return await this.status();
  }

  async logout(): Promise<ModelProviderStatus> {
    const pending = this.pendingLogin;
    pending?.cancel();
    this.pendingLogin = undefined;
    await pending?.completion.catch(() => undefined);
    this.lastError = undefined;
    await rm(this.credentialsPath, { force: true });

    return await this.status();
  }

  async validTokens(): Promise<OpenAiChatGptTokens | null> {
    const tokens = await this.readTokens();

    if (!tokens) return null;
    if (!isTokenExpired(tokens.expiresAt)) return tokens;

    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(tokens).finally(() => {
        this.refreshPromise = undefined;
      });
    }

    return await this.refreshPromise;
  }

  close(): void {
    this.pendingLogin?.cancel();
    this.pendingLogin = undefined;
  }

  private createLogin(): PendingLogin {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = randomBytes(16).toString('hex');
    const url = new URL(authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', scope);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    url.searchParams.set('originator', 'rdma26');

    let server: Server | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let resolveReady: (() => void) | undefined;
    let rejectReady: ((reason: Error) => void) | undefined;
    let rejectCompletion: ((reason: Error) => void) | undefined;
    let settled = false;

    const close = (): void => {
      if (timeout) clearTimeout(timeout);
      server?.close();
    };
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const completion = new Promise<OpenAiChatGptTokens>((resolve, reject) => {
      rejectCompletion = reject;
      server = createServer((request, response) => {
        const callback = new URL(request.url ?? '', `http://localhost:${this.callbackPort}`);

        if (callback.pathname !== '/auth/callback') {
          response.writeHead(404).end();
          return;
        }
        if (callback.searchParams.get('state') !== state) {
          response.writeHead(400).end('OAuth state mismatch. Return to rdma26 and try again.');
          return;
        }

        const code = callback.searchParams.get('code');
        if (!code) {
          response.writeHead(400).end('Missing authorization code.');
          return;
        }

        if (settled) {
          response.writeHead(409).end('This ChatGPT login has already completed.');
          return;
        }

        settled = true;
        if (timeout) clearTimeout(timeout);
        void this.exchangeAuthorizationCodeImplementation(code, verifier, this.redirectUri)
          .then(async (tokens) => {
            await this.writeTokens(tokens);
            response
              .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
              .end(
                '<!doctype html><title>rdma26</title><p>ChatGPT login complete. You can close this tab.</p>',
              );
            close();
            resolve(tokens);
          })
          .catch((error: unknown) => {
            const message = safeErrorMessage(error);
            response
              .writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
              .end(
                `<!doctype html><title>rdma26</title><p>ChatGPT login failed: ${escapeHtml(message)}</p>`,
              );
            close();
            reject(error);
          });
      });
      server.once('error', (error) => {
        if (settled) return;
        settled = true;
        close();
        const callbackError = new Error(
          errorMessageWithCode(
            error,
            `Could not start the ChatGPT callback on localhost:${this.callbackPort}.`,
          ),
        );
        rejectReady?.(callbackError);
        reject(callbackError);
      });
      server.once('listening', () => resolveReady?.());
      server.listen(this.callbackPort, 'localhost');
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        close();
        reject(new Error('ChatGPT login timed out. Start a new login and try again.'));
      }, loginTimeoutMs);
    });

    return {
      authorizationUrl: url.toString(),
      ready,
      completion,
      cancel: () => {
        if (settled) return;
        settled = true;
        close();
        const cancelled = new Error('ChatGPT login was cancelled.');
        rejectReady?.(cancelled);
        rejectCompletion?.(cancelled);
      },
    };
  }

  private async refresh(tokens: OpenAiChatGptTokens): Promise<OpenAiChatGptTokens> {
    try {
      const refreshed = await exchangeTokens(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          client_id: clientId,
        }),
        tokens.refreshToken,
      );
      await this.writeTokens(refreshed);
      this.lastError = undefined;
      return refreshed;
    } catch (error) {
      this.lastError = safeErrorMessage(error);
      throw error;
    }
  }

  private async readTokens(): Promise<OpenAiChatGptTokens | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.credentialsPath, 'utf8'));
      return parseStoredTokens(parsed);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        throw new Error('Stored ChatGPT credentials are invalid. Sign out and sign in again.');
      }
      throw error;
    }
  }

  private async writeTokens(tokens: OpenAiChatGptTokens): Promise<void> {
    const directory = dirname(this.credentialsPath);
    const temporaryPath = `${this.credentialsPath}.${process.pid}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(temporaryPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.credentialsPath);
    await chmod(this.credentialsPath, 0o600);
  }
}

export function decodeChatGptIdentity(accessToken: string): {
  readonly accountId?: string;
  readonly email?: string;
  readonly plan?: string;
} {
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) return {};

  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!isRecord(payload)) return {};
    const auth = asRecord(payload['https://api.openai.com/auth']);
    const profile = asRecord(payload['https://api.openai.com/profile']);

    return {
      ...(asNonEmptyString(auth?.['chatgpt_account_id'])
        ? { accountId: asNonEmptyString(auth?.['chatgpt_account_id']) }
        : {}),
      ...(asNonEmptyString(profile?.['email'])
        ? { email: asNonEmptyString(profile?.['email']) }
        : {}),
      ...(asNonEmptyString(auth?.['chatgpt_plan_type'])
        ? { plan: asNonEmptyString(auth?.['chatgpt_plan_type']) }
        : {}),
    };
  } catch {
    return {};
  }
}

export function isTokenExpired(
  expiresAt: number,
  now = Date.now(),
  threshold = refreshThresholdMs,
): boolean {
  return !Number.isFinite(expiresAt) || now >= expiresAt - threshold;
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OpenAiChatGptTokens> {
  return await exchangeTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  );
}

async function exchangeTokens(
  body: URLSearchParams,
  fallbackRefreshToken?: string,
): Promise<OpenAiChatGptTokens> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`ChatGPT token request failed (${response.status}). Sign in again.`);
  }

  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error('ChatGPT returned an invalid token response.');
  const accessToken = asNonEmptyString(value['access_token']);
  const refreshToken = asNonEmptyString(value['refresh_token']) ?? fallbackRefreshToken;
  const expiresIn = value['expires_in'];

  if (!accessToken || !refreshToken || typeof expiresIn !== 'number') {
    throw new Error('ChatGPT token response is missing required fields.');
  }

  const identity = decodeChatGptIdentity(accessToken);
  if (!identity.accountId) {
    throw new Error('ChatGPT access token does not contain an account id.');
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId: identity.accountId,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.plan ? { plan: identity.plan } : {}),
  };
}

function parseStoredTokens(value: unknown): OpenAiChatGptTokens {
  if (!isRecord(value)) throw new Error('Stored ChatGPT credentials are invalid.');
  const accessToken = asNonEmptyString(value['accessToken']);
  const refreshToken = asNonEmptyString(value['refreshToken']);
  const accountId = asNonEmptyString(value['accountId']);
  const expiresAt = value['expiresAt'];

  if (!accessToken || !refreshToken || !accountId || typeof expiresAt !== 'number') {
    throw new Error('Stored ChatGPT credentials are incomplete. Sign in again.');
  }

  return {
    accessToken,
    refreshToken,
    accountId,
    expiresAt,
    ...(asNonEmptyString(value['email']) ? { email: asNonEmptyString(value['email']) } : {}),
    ...(asNonEmptyString(value['plan']) ? { plan: asNonEmptyString(value['plan']) } : {}),
  };
}

function formatAccount(email: string, plan?: string): string {
  if (!plan) return email;
  return `${email} (${plan.charAt(0).toUpperCase()}${plan.slice(1)})`;
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'ChatGPT authentication failed.';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function errorMessageWithCode(error: unknown, fallback: string): string {
  return isNodeError(error) && error.code ? `${fallback} (${error.code})` : fallback;
}
