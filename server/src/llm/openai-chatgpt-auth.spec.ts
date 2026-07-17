import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeChatGptIdentity,
  isTokenExpired,
  OpenAiChatGptAuthService,
} from './openai-chatgpt-auth';

describe('OpenAiChatGptAuthService', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('decodes account metadata from ChatGPT access-token claims', () => {
    const token = jwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123',
        chatgpt_plan_type: 'pro',
      },
      'https://api.openai.com/profile': {
        email: 'rolf@example.com',
      },
    });

    expect(decodeChatGptIdentity(token)).toEqual({
      accountId: 'account-123',
      email: 'rolf@example.com',
      plan: 'pro',
    });
  });

  it('refreshes near expiry and rejects invalid expiry values', () => {
    expect(isTokenExpired(120_000, 0)).toBe(false);
    expect(isTokenExpired(60_000, 0)).toBe(true);
    expect(isTokenExpired(Number.NaN, 0)).toBe(true);
  });

  it('returns metadata without exposing stored tokens and deletes credentials on logout', async () => {
    const dataDir = await temporaryDataDir(temporaryDirectories);
    const credentialsPath = join(dataDir, 'provider-auth', 'openai-chatgpt.json');
    await mkdir(dirname(credentialsPath), { recursive: true, mode: 0o700 });
    await writeFile(
      credentialsPath,
      JSON.stringify({
        accessToken: 'secret-access',
        refreshToken: 'secret-refresh',
        expiresAt: Date.now() + 3_600_000,
        accountId: 'account-123',
        email: 'rolf@example.com',
        plan: 'pro',
      }),
      { mode: 0o600 },
    );
    const service = new OpenAiChatGptAuthService(dataDir);

    const status = await service.status();

    expect(status).toMatchObject({
      authenticated: true,
      account: 'rolf@example.com (Pro)',
    });
    expect(JSON.stringify(status)).not.toContain('secret-access');
    await service.logout();
    await expect(readFile(credentialsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the provider-auth directory and token file private', async () => {
    const dataDir = await temporaryDataDir(temporaryDirectories);
    const credentialsPath = join(dataDir, 'provider-auth', 'openai-chatgpt.json');
    await mkdir(dirname(credentialsPath), { recursive: true, mode: 0o700 });
    await writeFile(
      credentialsPath,
      JSON.stringify({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
        accountId: 'account',
      }),
      { mode: 0o600 },
    );

    expect((await stat(dirname(credentialsPath))).mode & 0o777).toBe(0o700);
    expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
  });

  it('reports callback success only after exchanged tokens are securely persisted', async () => {
    const dataDir = await temporaryDataDir(temporaryDirectories);
    const callbackPort = await availablePort();
    const tokens = {
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh',
      expiresAt: Date.now() + 3_600_000,
      accountId: 'account-123',
      email: 'rolf@example.com',
      plan: 'pro',
    };
    const exchangeAuthorizationCode = vi.fn(async () => tokens);
    const service = new OpenAiChatGptAuthService(dataDir, {
      callbackPort,
      exchangeAuthorizationCode,
    });
    const login = await service.startLogin();
    const authorizationUrl = new URL(login.authorizationUrl);
    const state = authorizationUrl.searchParams.get('state');
    const redirectUri = authorizationUrl.searchParams.get('redirect_uri');

    expect(state).toBeTruthy();
    expect(redirectUri).toBe(`http://localhost:${callbackPort}/auth/callback`);

    const response = await fetch(`${redirectUri}?code=test-code&state=${state}`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('ChatGPT login complete');
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      'test-code',
      expect.any(String),
      redirectUri,
    );
    await expect(service.status()).resolves.toMatchObject({
      authenticated: true,
      account: 'rolf@example.com (Pro)',
      loginPending: false,
    });
    const credentialsPath = join(dataDir, 'provider-auth', 'openai-chatgpt.json');
    expect(JSON.parse(await readFile(credentialsPath, 'utf8'))).toEqual(tokens);
    expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
  });

  it('cancels a pending login without retaining a cancellation error', async () => {
    const dataDir = await temporaryDataDir(temporaryDirectories);
    const service = new OpenAiChatGptAuthService(dataDir, {
      callbackPort: await availablePort(),
    });
    await service.startLogin();

    await expect(service.logout()).resolves.toMatchObject({
      authenticated: false,
      loginPending: false,
    });
    expect((await service.status()).error).toBeUndefined();
  });
});

function jwt(payload: Record<string, unknown>): string {
  return `${base64Url({ alg: 'none' })}.${base64Url(payload)}.`;
}

function base64Url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function temporaryDataDir(paths: string[]): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'rdma26-chatgpt-auth-'));
  paths.push(path);
  return path;
}

async function availablePort(): Promise<number> {
  const server = createServer();

  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a callback port.'));
        return;
      }

      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
