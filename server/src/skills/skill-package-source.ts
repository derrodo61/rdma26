import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { parse } from 'yaml';

import { AppError } from '../errors/app-error';
import { listFiles } from './skill-library';

const maxFiles = 200;
const maxFileBytes = 5 * 1024 * 1024;
const maxPackageBytes = 50 * 1024 * 1024;
const maxArchiveBytes = 50 * 1024 * 1024;
const maxCompressionRatio = 200;

export interface StagedSkillPackage {
  readonly directory: string;
  readonly resolvedRevision?: string;
  cleanup(): Promise<void>;
}

export async function stageLocalDirectory(sourceDirectory: string): Promise<StagedSkillPackage> {
  const source = resolve(sourceDirectory);
  const info = await lstatSource(source, {
    notFound: 'SKILL_SOURCE_NOT_FOUND',
    notReadable: 'SKILL_SOURCE_NOT_READABLE',
  });

  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AppError('SKILL_SOURCE_NOT_USABLE', { path: source });
  }

  const stagingRoot = await createStagingRoot();
  const destination = join(stagingRoot, basename(source));

  try {
    await copySafeTree(source, destination);
    return staged(destination, stagingRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function stageZipArchive(archivePath: string): Promise<StagedSkillPackage> {
  const source = resolve(archivePath);
  const info = await lstatSource(source, {
    notFound: 'SKILL_ARCHIVE_NOT_FOUND',
    notReadable: 'SKILL_ARCHIVE_NOT_READABLE',
  });

  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AppError('SKILL_ARCHIVE_NOT_USABLE', { path: source });
  }
  if (info.size > maxArchiveBytes) {
    throw new AppError('SKILL_ARCHIVE_TOO_LARGE', {
      path: source,
      limitBytes: maxArchiveBytes,
    });
  }
  if (!source.toLowerCase().endsWith('.zip')) {
    throw new AppError('SKILL_ARCHIVE_UNSUPPORTED_TYPE', { path: source });
  }

  const stagingRoot = await createStagingRoot();
  const extractionRoot = join(stagingRoot, 'extracted');
  await mkdir(extractionRoot, { recursive: true });

  try {
    await extractZip(source, extractionRoot);
    const packageRoot = await findArchivePackageRoot(extractionRoot);
    const normalizedRoot = await normalizeArchivePackageRoot(packageRoot, stagingRoot);
    return staged(normalizedRoot, stagingRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function stageGitPackage(options: {
  readonly repositoryUrl: string;
  readonly packagePath?: string;
  readonly revision?: string;
}): Promise<StagedSkillPackage> {
  validateGitUrl(options.repositoryUrl);
  const packagePath = normalizePackagePath(options.packagePath ?? '');
  const revision = options.revision?.trim() || 'HEAD';
  const stagingRoot = await createStagingRoot();
  const repositoryDir = join(stagingRoot, 'repository.git');

  try {
    await runGit(['init', '--bare', repositoryDir]);
    await runGit([
      '-C',
      repositoryDir,
      '-c',
      'core.hooksPath=/dev/null',
      'fetch',
      '--depth=1',
      '--no-tags',
      options.repositoryUrl,
      revision,
    ]);
    const resolvedRevision = (await runGit(['-C', repositoryDir, 'rev-parse', 'FETCH_HEAD']))
      .toString('utf8')
      .trim();
    const treeOutput = await runGit([
      '-C',
      repositoryDir,
      'ls-tree',
      '-r',
      '-z',
      'FETCH_HEAD',
      ...(packagePath ? ['--', packagePath] : []),
    ]);
    const entries = parseGitTree(treeOutput, packagePath);

    if (!entries.length) {
      throw new Error('The Git source does not contain files at the requested package path.');
    }

    const inferredName = packagePath
      ? basename(packagePath)
      : basename(new URL(options.repositoryUrl).pathname).replace(/\.git$/i, '');
    const packageRoot = join(stagingRoot, inferredName);
    let totalBytes = 0;

    for (const entry of entries) {
      const content = await runGit([
        '-C',
        repositoryDir,
        'show',
        `FETCH_HEAD:${entry.repositoryPath}`,
      ]);
      totalBytes += content.length;
      enforceFileLimits(entries.length, content.length, totalBytes);
      const destination = safeDestination(packageRoot, entry.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, { mode: entry.executable ? 0o755 : 0o644 });
    }

    return {
      directory: packageRoot,
      resolvedRevision,
      cleanup: async () => await rm(stagingRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function stageZipBuffer(buffer: Buffer): Promise<StagedSkillPackage> {
  if (buffer.length > maxArchiveBytes) {
    throw new AppError('SKILL_ARCHIVE_TOO_LARGE', { limitBytes: maxArchiveBytes });
  }

  const temporaryRoot = await createStagingRoot();
  const archivePath = join(temporaryRoot, 'download.zip');
  await writeFile(archivePath, buffer);

  try {
    const stagedArchive = await stageZipArchive(archivePath);
    await rm(temporaryRoot, { recursive: true, force: true });
    return stagedArchive;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function lstatSource(
  path: string,
  codes: {
    readonly notFound: 'SKILL_ARCHIVE_NOT_FOUND' | 'SKILL_SOURCE_NOT_FOUND';
    readonly notReadable: 'SKILL_ARCHIVE_NOT_READABLE' | 'SKILL_SOURCE_NOT_READABLE';
  },
): ReturnType<typeof lstat> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new AppError(codes.notFound, { path });
    }
    if (isNodeError(error) && error.code === 'EACCES') {
      throw new AppError(codes.notReadable, { path });
    }
    throw error;
  }
}

async function copySafeTree(source: string, destination: string): Promise<void> {
  const files = await listFiles(source);
  let totalBytes = 0;

  for (const file of files) {
    const info = await lstat(file);
    totalBytes += info.size;
    enforceFileLimits(files.length, info.size, totalBytes);
    const path = relative(source, file);
    const target = safeDestination(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(file), { mode: info.mode & 0o111 ? 0o755 : 0o644 });
  }
}

async function extractZip(archivePath: string, extractionRoot: string): Promise<void> {
  const zipFile = await openZip(archivePath);
  const seen = new Set<string>();
  let fileCount = 0;
  let totalBytes = 0;

  await new Promise<void>((resolvePromise, reject) => {
    const fail = (error: unknown): void => {
      zipFile.close();
      reject(error);
    };

    zipFile.on('error', fail);
    zipFile.on('end', resolvePromise);
    zipFile.on('entry', (entry: Entry) => {
      void handleZipEntry(zipFile, entry, extractionRoot, seen, {
        accountFile(size, compressedSize) {
          fileCount += 1;
          totalBytes += size;
          enforceFileLimits(fileCount, size, totalBytes);

          if (compressedSize > 0 && size / compressedSize > maxCompressionRatio) {
            throw new Error(`ZIP entry ${entry.fileName} has an unsafe compression ratio.`);
          }
        },
      })
        .then(() => zipFile.readEntry())
        .catch(fail);
    });
    zipFile.readEntry();
  });
}

async function handleZipEntry(
  zipFile: ZipFile,
  entry: Entry,
  extractionRoot: string,
  seen: Set<string>,
  limits: { accountFile(size: number, compressedSize: number): void },
): Promise<void> {
  const path = normalizeZipPath(entry.fileName);

  if (!path) {
    return;
  }
  if (seen.has(path)) {
    throw new Error(`ZIP archive contains duplicate path ${path}.`);
  }
  seen.add(path);

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const unixType = unixMode & 0o170000;

  if (unixType === 0o120000) {
    throw new Error(`ZIP archive contains unsupported symbolic link ${path}.`);
  }
  if (unixType !== 0 && unixType !== 0o100000 && !(path.endsWith('/') && unixType === 0o040000)) {
    throw new Error(`ZIP archive contains unsupported entry type ${path}.`);
  }

  if (path.endsWith('/')) {
    const destination = safeDirectoryDestination(extractionRoot, path);
    await mkdir(destination, { recursive: true });
    return;
  }

  const destination = safeDestination(extractionRoot, path);
  limits.accountFile(entry.uncompressedSize, entry.compressedSize);
  await mkdir(dirname(destination), { recursive: true });
  const stream = await openZipEntry(zipFile, entry);
  await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o644 }));
}

async function findArchivePackageRoot(extractionRoot: string): Promise<string> {
  try {
    const rootSkill = join(extractionRoot, 'SKILL.md');
    if ((await lstat(rootSkill)).isFile()) {
      return extractionRoot;
    }
  } catch {
    // Continue with the one-wrapper-directory form.
  }

  const topLevel = new Set(
    (await listFiles(extractionRoot)).map((file) => relative(extractionRoot, file).split(sep)[0]),
  );

  if (topLevel.size !== 1) {
    throw new Error('ZIP archive must contain one skill package with SKILL.md at its root.');
  }

  const [wrapper] = topLevel;
  const packageRoot = join(extractionRoot, wrapper);

  try {
    if ((await lstat(join(packageRoot, 'SKILL.md'))).isFile()) {
      return packageRoot;
    }
  } catch {
    // Report the common archive-shape error below.
  }

  throw new Error('ZIP archive must contain one skill package with SKILL.md at its root.');
}

async function normalizeArchivePackageRoot(
  packageRoot: string,
  stagingRoot: string,
): Promise<string> {
  const skillId = readSkillName(await readFile(join(packageRoot, 'SKILL.md'), 'utf8'));

  if (basename(packageRoot) === skillId) {
    return packageRoot;
  }

  const normalizedRoot = join(stagingRoot, 'package', skillId);
  await copySafeTree(packageRoot, normalizedRoot);
  return normalizedRoot;
}

function readSkillName(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match?.[1]) {
    throw new Error('Archived SKILL.md must start with YAML frontmatter.');
  }

  const frontmatter = parse(match[1]) as unknown;

  if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) {
    throw new Error('Archived SKILL.md has invalid YAML frontmatter.');
  }

  const name = (frontmatter as Record<string, unknown>)['name'];

  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error('Archived SKILL.md has an invalid name.');
  }

  return name;
}

export function parseGitTree(
  output: Buffer,
  packagePath: string,
): readonly {
  repositoryPath: string;
  relativePath: string;
  executable: boolean;
}[] {
  const entries = output.toString('utf8').split('\0').filter(Boolean);

  return entries.map((line) => {
    const match = line.match(/^(\d+) (\w+) [a-f0-9]+\t(.+)$/);

    if (!match?.[1] || !match[2] || !match[3]) {
      throw new Error('Git returned an invalid tree entry.');
    }
    if (match[2] !== 'blob' || !['100644', '100755'].includes(match[1])) {
      throw new Error(`Git package contains unsupported entry ${match[3]}.`);
    }

    const relativePath = packagePath
      ? match[3].slice(packagePath.length).replace(/^\//, '')
      : match[3];
    validateRelativePath(relativePath);

    return {
      repositoryPath: match[3],
      relativePath,
      executable: match[1] === '100755',
    };
  });
}

function normalizePackagePath(input: string): string {
  const value = input.trim().replace(/^\/+|\/+$/g, '');

  if (value) {
    validateRelativePath(value);
  }

  return value;
}

function normalizeZipPath(input: string): string {
  if (input.includes('\\') || input.includes('\0') || input.startsWith('/')) {
    throw new Error(`ZIP archive contains unsafe path ${JSON.stringify(input)}.`);
  }

  const value = normalize(input).replaceAll('\\', '/');
  validateRelativePath(value.replace(/\/$/, ''));
  return value;
}

function validateRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => part === '..' || !part)) {
    throw new Error(`Unsafe package path ${JSON.stringify(path)}.`);
  }
}

function safeDestination(root: string, path: string): string {
  validateRelativePath(path);
  return resolveSafeDestination(root, path);
}

function safeDirectoryDestination(root: string, path: string): string {
  const normalized = path.replace(/\/+$/, '');
  validateRelativePath(normalized);
  return resolveSafeDestination(root, normalized);
}

function resolveSafeDestination(root: string, path: string): string {
  const destination = resolve(root, path);
  const relativeDestination = relative(resolve(root), destination);

  if (relativeDestination.startsWith('..') || isAbsolute(relativeDestination)) {
    throw new Error(`Package path escapes its root: ${path}.`);
  }

  return destination;
}

function enforceFileLimits(fileCount: number, fileBytes: number, totalBytes: number): void {
  if (fileCount > maxFiles) {
    throw new Error(`Skill package exceeds the ${maxFiles}-file limit.`);
  }
  if (fileBytes > maxFileBytes) {
    throw new Error(`Skill package contains a file larger than ${maxFileBytes} bytes.`);
  }
  if (totalBytes > maxPackageBytes) {
    throw new Error(`Skill package exceeds the ${maxPackageBytes}-byte limit.`);
  }
}

function validateGitUrl(repositoryUrl: string): void {
  let url: URL;

  try {
    url = new URL(repositoryUrl);
  } catch {
    throw new Error('Git repository URL must be a valid HTTPS URL.');
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Git repository URL must use HTTPS and must not embed credentials.');
  }
}

async function runGit(args: readonly string[]): Promise<Buffer> {
  return await new Promise<Buffer>((resolvePromise, reject) => {
    const child = spawn('git', [...args], {
      env: {
        PATH: process.env['PATH'],
        HOME: process.env['HOME'],
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxPackageBytes) {
        child.kill('SIGKILL');
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (outputBytes > maxPackageBytes) {
        reject(new Error('Git output exceeded the skill package size limit.'));
      } else if (code === 0) {
        resolvePromise(Buffer.concat(stdout));
      } else {
        reject(new Error(`Git command failed: ${Buffer.concat(stderr).toString('utf8').trim()}`));
      }
    });
  });
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('Could not open ZIP archive.'));
      } else {
        resolvePromise(zipFile);
      }
    });
  });
}

function openZipEntry(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`Could not read ZIP entry ${entry.fileName}.`));
      } else {
        resolvePromise(stream);
      }
    });
  });
}

async function createStagingRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'rdma26-skill-stage-'));
}

function staged(directory: string, stagingRoot: string): StagedSkillPackage {
  return {
    directory,
    cleanup: async () => await rm(stagingRoot, { recursive: true, force: true }),
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
