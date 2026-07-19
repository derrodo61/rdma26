import type { CatalogSearchResponse, CatalogSkillSummary } from '../../../shared/agent-contracts';
import { stageGitPackage, stageZipBuffer, type StagedSkillPackage } from './skill-package-source';

const maxDownloadBytes = 50 * 1024 * 1024;

export interface ResolvedCatalogSkill {
  readonly staged: StagedSkillPackage;
  readonly catalogSkillId: string;
  readonly version?: string;
  readonly resolvedRevision?: string;
  readonly author?: string;
  readonly license?: string;
  readonly canonicalUrl: string;
}

export interface SkillCatalogAdapter {
  readonly id: string;
  search(query: string, limit?: number): Promise<CatalogSearchResponse>;
  resolve(skillId: string, version?: string): Promise<ResolvedCatalogSkill>;
}

export class ClawHubCatalogAdapter implements SkillCatalogAdapter {
  readonly id = 'clawhub';

  constructor(
    private readonly baseUrl = 'https://clawhub.ai',
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async search(query: string, limit = 20): Promise<CatalogSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      throw new Error('ClawHub search query is required.');
    }

    const url = new URL('/api/v1/search', this.baseUrl);
    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 100)));
    url.searchParams.set('nonSuspiciousOnly', 'true');
    const payload = await this.fetchJson(url);
    const results = readArray(readRecord(payload)?.['results']).map(toCatalogSummary);

    return { results };
  }

  async resolve(skillId: string, version?: string): Promise<ResolvedCatalogSkill> {
    const reference = parseCatalogSkillId(skillId);
    const normalizedSkillId = reference.owner
      ? `@${reference.owner}/${reference.slug}`
      : reference.slug;
    const detailUrl = new URL(`/api/v1/skills/${encodeURIComponent(reference.slug)}`, this.baseUrl);
    if (reference.owner) {
      detailUrl.searchParams.set('owner', reference.owner);
    }
    const detail = readRecord(await this.fetchJson(detailUrl));
    const skill = readRecord(detail?.['skill']);
    const owner = readRecord(detail?.['owner']);
    const moderation = readRecord(detail?.['moderation']);
    const resolvedVersion =
      version?.trim() || readString(readRecord(detail?.['latestVersion'])?.['version']);

    if (moderation?.['isMalwareBlocked'] === true || moderation?.['isSuspicious'] === true) {
      throw new Error('ClawHub refused this skill because its moderation state is not clean.');
    }

    const ownerHandle = readString(owner?.['handle']);
    if (reference.owner && ownerHandle !== reference.owner) {
      throw new Error('ClawHub returned a different publisher than the requested skill reference.');
    }
    const canonicalSlug = readString(skill?.['slug']) ?? normalizedSkillId;
    const canonicalUrl = ownerHandle
      ? `${this.baseUrl}/${encodeURIComponent(ownerHandle)}/skills/${encodeURIComponent(canonicalSlug)}`
      : `${this.baseUrl}/skills/${encodeURIComponent(canonicalSlug)}`;
    const downloadUrl = new URL('/api/v1/download', this.baseUrl);
    downloadUrl.searchParams.set('slug', reference.slug);
    if (reference.owner) {
      downloadUrl.searchParams.set('owner', reference.owner);
    }
    if (resolvedVersion) {
      downloadUrl.searchParams.set('version', resolvedVersion);
    }

    const response = await this.fetchResponse(downloadUrl);
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const handoff = readRecord(await response.json());

      if (handoff?.['sourceRef'] !== 'public-github') {
        throw new Error('ClawHub returned an unsupported download handoff.');
      }

      const repo = requireString(handoff['repo'], 'ClawHub GitHub repository');
      const commit = requireString(handoff['commit'], 'ClawHub GitHub commit');
      const path = requireString(handoff['path'], 'ClawHub GitHub package path');
      const repositoryUrl = repo.startsWith('https://') ? repo : `https://github.com/${repo}.git`;
      const staged = await stageGitPackage({
        repositoryUrl,
        packagePath: path,
        revision: commit,
      });

      return {
        staged,
        catalogSkillId: normalizedSkillId,
        version: resolvedVersion,
        resolvedRevision: staged.resolvedRevision,
        author: ownerHandle,
        license: 'MIT-0',
        canonicalUrl,
      };
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > maxDownloadBytes) {
      throw new Error('ClawHub skill archive exceeds the download size limit.');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxDownloadBytes) {
      throw new Error('ClawHub skill archive exceeds the download size limit.');
    }

    return {
      staged: await stageZipBuffer(buffer),
      catalogSkillId: normalizedSkillId,
      version: resolvedVersion,
      author: ownerHandle,
      license: 'MIT-0',
      canonicalUrl,
    };
  }

  private async fetchJson(url: URL): Promise<unknown> {
    return await (await this.fetchResponse(url)).json();
  }

  private async fetchResponse(url: URL): Promise<Response> {
    const response = await this.fetchImplementation(url, {
      headers: { Accept: 'application/json, application/zip' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const message = (await response.text()).trim();
      throw new Error(
        `ClawHub request failed (${response.status}): ${message || response.statusText}`,
      );
    }

    return response;
  }
}

function toCatalogSummary(value: unknown): CatalogSkillSummary {
  const result = readRecord(value);
  const slug = requireString(result?.['slug'], 'ClawHub result slug');
  const owner = readRecord(result?.['owner']);
  const ownerHandle = readString(result?.['ownerHandle']) ?? readString(owner?.['handle']);

  return {
    catalogId: 'clawhub',
    skillId: ownerHandle ? `@${ownerHandle}/${slug}` : slug,
    displayName: readString(result?.['displayName']) ?? slug,
    description: readString(result?.['summary']) ?? '',
    version: readString(result?.['version']),
    author: ownerHandle,
    canonicalUrl: ownerHandle
      ? `https://clawhub.ai/${encodeURIComponent(ownerHandle)}/skills/${encodeURIComponent(slug)}`
      : `https://clawhub.ai/skills/${encodeURIComponent(slug)}`,
  };
}

function parseCatalogSkillId(value: string): { owner?: string; slug: string } {
  const normalized = value.trim();

  if (!/^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/.test(normalized)) {
    throw new Error('ClawHub skill id is invalid.');
  }

  if (normalized.startsWith('@')) {
    const [owner, slug] = normalized.slice(1).split('/');
    if (!owner || !slug) {
      throw new Error('ClawHub owner-qualified skill id is invalid.');
    }
    return { owner, slug };
  }

  return { slug: normalized };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireString(value: unknown, label: string): string {
  const result = readString(value);

  if (!result) {
    throw new Error(`${label} is missing.`);
  }

  return result;
}
