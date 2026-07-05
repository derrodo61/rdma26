import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthSessionResponse, LoginRequest } from '../../shared/agent-contracts';

const cookieName = 'rdma26_session';
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

export interface AuthConfig {
  readonly enabled: boolean;
  readonly username?: string;
  readonly password?: string;
  readonly sessionSecret: string;
}

export function readAuthConfig(): AuthConfig {
  const username = process.env['RDMA26_USERNAME']?.trim();
  const password = process.env['RDMA26_PASSWORD']?.trim();
  const sessionSecret = process.env['RDMA26_SESSION_SECRET']?.trim() ?? 'local-dev-session-secret';

  return {
    enabled: Boolean(username && password),
    username,
    password,
    sessionSecret,
  };
}

export function sessionForRequest(
  request: FastifyRequest,
  config: AuthConfig,
): AuthSessionResponse {
  if (!config.enabled) {
    return {
      authEnabled: false,
      authenticated: true,
    };
  }

  const username = readVerifiedSessionUsername(request, config);

  return {
    authEnabled: true,
    authenticated: Boolean(username),
    username,
  };
}

export function login(
  reply: FastifyReply,
  config: AuthConfig,
  request: LoginRequest,
): AuthSessionResponse {
  if (!config.enabled) {
    return {
      authEnabled: false,
      authenticated: true,
    };
  }

  if (request.username !== config.username || request.password !== config.password) {
    throw new Error('Invalid username or password.');
  }

  const token = createSessionToken(request.username, Date.now() + sessionTtlMs, config);
  setSessionCookie(reply, token, sessionTtlMs);

  return {
    authEnabled: true,
    authenticated: true,
    username: request.username,
  };
}

export function logout(reply: FastifyReply, config: AuthConfig): AuthSessionResponse {
  reply.header('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

  return {
    authEnabled: config.enabled,
    authenticated: false,
  };
}

export function isAuthExemptPath(path: string): boolean {
  return path === '/api/auth/session' || path === '/api/auth/login' || path === '/api/auth/logout';
}

function createSessionToken(username: string, expiresAt: number, config: AuthConfig): string {
  const payload = Buffer.from(JSON.stringify({ username, expiresAt }), 'utf8').toString(
    'base64url',
  );
  const signature = sign(payload, config);

  return `${payload}.${signature}`;
}

function readVerifiedSessionUsername(
  request: FastifyRequest,
  config: AuthConfig,
): string | undefined {
  const token = parseCookies(request.headers.cookie ?? '')[cookieName];

  if (!token) {
    return undefined;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature || !safeEqual(signature, sign(payload, config))) {
    return undefined;
  }

  const parsed = parsePayload(payload);

  if (!parsed || parsed.expiresAt < Date.now()) {
    return undefined;
  }

  return parsed.username;
}

function parsePayload(payload: string): { username: string; expiresAt: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed['username'] === 'string' &&
      typeof parsed['expiresAt'] === 'number'
    ) {
      return {
        username: parsed['username'],
        expiresAt: parsed['expiresAt'],
      };
    }
  } catch {
    return null;
  }

  return null;
}

function sign(payload: string, config: AuthConfig): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function setSessionCookie(reply: FastifyReply, token: string, maxAgeMs: number): void {
  reply.header(
    'Set-Cookie',
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  );
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf('=');

        if (separatorIndex === -1) {
          return [part, ''];
        }

        return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)];
      }),
  );
}
