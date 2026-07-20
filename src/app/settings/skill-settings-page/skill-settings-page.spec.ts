import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import type {
  SkillPackageDetails,
  SkillProposalRecord,
  UserProfile,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
import { UserProfileSyncService } from '../user-profile-sync';
import { SkillSettingsPage } from './skill-settings-page';

describe('SkillSettingsPage', () => {
  let fixture: ComponentFixture<SkillSettingsPage>;
  const proposal = pendingProposal();
  const api = {
    skills: vi.fn(async () => ({ skills: [] })),
    skillInstallations: vi.fn(async () => ({ installations: [] })),
    agents: vi.fn(async () => ({ agents: [], defaultAgentId: 'scotty' })),
    skillProposals: vi.fn(async () => ({ proposals: [proposal] })),
    applySkillProposal: vi.fn(async () => ({ ...proposal, state: 'applied' as const })),
  };
  const profileSync = userProfileSyncMock();

  beforeEach(async () => {
    vi.clearAllMocks();
    profileSync.profile.set(userProfile());
    await TestBed.configureTestingModule({
      imports: [SkillSettingsPage],
      providers: [
        provideRouter([]),
        { provide: AssistantApi, useValue: api },
        { provide: UserProfileSyncService, useValue: profileSync },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SkillSettingsPage);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('invoice-review');
    });
  });

  it('shows proposal evidence and applies only after explicit confirmation', async () => {
    buttonContaining('invoice-review').click();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Requested during invoice review.');
    expect(root.textContent).toContain('SKILL.md');
    expect(root.textContent).toContain('pending');

    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    buttonContaining('Apply proposal').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(confirm).toHaveBeenCalled();
    expect(api.applySkillProposal).toHaveBeenCalledWith(proposal.id);
    expect(profileSync.loadProfile).toHaveBeenCalled();
    expect(root.textContent).toContain('Applied proposal for invoice-review.');
  });

  function buttonContaining(text: string): HTMLButtonElement {
    const root = fixture.nativeElement as HTMLElement;
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
      candidate.textContent?.includes(text),
    );
    if (!button) {
      throw new Error(`Button containing ${text} was not found.`);
    }
    return button;
  }
});

describe('SkillSettingsPage lifecycle', () => {
  it('shows plain source path installation errors without scanner findings', async () => {
    const source = skillDetails('pricing-analysis', 'bundled');
    const api = {
      ...lifecycleApi(source, source),
      installSkill: vi.fn(async () => {
        throw new HttpErrorResponse({
          status: 400,
          error: {
            code: 'SKILL_SOURCE_NOT_FOUND',
            message: 'Skill directory does not exist: /tmp/missing-skill',
            details: { path: '/tmp/missing-skill' },
          },
        });
      }),
    };
    const fixture = await createLifecycleFixture(api);

    const input = fixture.nativeElement.querySelector(
      'input[name="sourcePath"]',
    ) as HTMLInputElement;
    input.value = '/tmp/missing-skill';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttonContaining(fixture, 'Install').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Skill directory does not exist: /tmp/missing-skill');
    expect(text).not.toContain('ENOENT');
  });

  it('shows scanner findings when skill installation fails validation', async () => {
    const source = skillDetails('pricing-analysis', 'bundled');
    const api = {
      ...lifecycleApi(source, source),
      installSkill: vi.fn(async () => {
        throw new HttpErrorResponse({
          status: 400,
          error: {
            code: 'SKILL_PACKAGE_INVALID',
            message: 'The skill package is invalid.',
            compatibility: {
              status: 'unsafe_or_invalid',
              requiredCapabilities: [],
              missingCapabilities: [],
              unsupportedRequirements: [],
              findings: [
                {
                  code: 'invalid_package',
                  severity: 'error',
                  message:
                    'Skill name manual-reference-check must match its directory name rdma26-manual-skill-test.',
                },
              ],
            },
          },
        });
      }),
    };
    const fixture = await createLifecycleFixture(api);

    const input = fixture.nativeElement.querySelector(
      'input[name="sourcePath"]',
    ) as HTMLInputElement;
    input.value = '/tmp/rdma26-manual-skill-test';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttonContaining(fixture, 'Install').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('The skill package is invalid.');
    expect(text).toContain(
      'Skill name manual-reference-check must match its directory name rdma26-manual-skill-test.',
    );
  });

  it('clones an immutable skill with an explicit user-owned id', async () => {
    const source = skillDetails('pricing-analysis', 'bundled');
    const cloned = skillDetails('custom-pricing', 'user');
    const api = lifecycleApi(source, cloned);
    const fixture = await createLifecycleFixture(api);

    buttonContaining(fixture, source.id).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      'input[placeholder="my-custom-skill"]',
    ) as HTMLInputElement;
    input.value = cloned.id;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttonContaining(fixture, 'Clone').click();
    await fixture.whenStable();

    expect(api.cloneSkill).toHaveBeenCalledWith(source.id, {
      targetSkillId: cloned.id,
      expectedSourceHash: source.contentHash,
    });
  });

  it('edits and deletes an unattached user-owned skill', async () => {
    const skill = skillDetails('invoice-review', 'user');
    const updated = {
      ...skill,
      description: 'Review invoices carefully.',
      contentHash: 'b'.repeat(64),
      skillMarkdown: skill.skillMarkdown.replace(
        'Review invoice batches.',
        'Review invoices carefully.',
      ),
    };
    const api = lifecycleApi(skill, updated);
    const fixture = await createLifecycleFixture(api);

    buttonContaining(fixture, skill.id).click();
    await fixture.whenStable();
    fixture.detectChanges();
    buttonWithLabel(fixture, 'Edit skill').click();
    fixture.detectChanges();

    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = updated.skillMarkdown;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttonContaining(fixture, 'Save').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.updateUserSkill).toHaveBeenCalledWith(skill.id, {
      skillMarkdown: updated.skillMarkdown,
      expectedContentHash: skill.contentHash,
    });

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    buttonWithLabel(fixture, 'Delete skill').click();
    await fixture.whenStable();
    expect(api.deleteSkill).toHaveBeenCalledWith(skill.id, {
      expectedContentHash: updated.contentHash,
    });
  });

  it('lists changed files in an inspected external skill update', async () => {
    const skill = skillDetails('manual-reference-check', 'external');
    const retainedAt = '2026-07-20T15:14:04.832Z';
    const currentAt = '2026-07-20T15:44:29.466Z';
    const api = {
      ...lifecycleApi(skill, skill),
      readSkillFile: vi.fn(async () => ({
        skillId: skill.id,
        path: 'references/marker.md',
        content: 'The exact marker is REFERENCE-SKILL-731.',
        sizeBytes: 41,
      })),
      skillInstallations: vi.fn(async () => ({
        installations: [
          {
            skillId: skill.id,
            source: { type: 'local-directory' as const, path: '/tmp/manual-reference-check' },
            activeContentHash: skill.contentHash,
            pinned: false,
            installedAt: retainedAt,
            updatedAt: currentAt,
            versions: [
              {
                contentHash: 'b'.repeat(64),
                installedAt: retainedAt,
                compatibility: compatibleReport(),
              },
              {
                contentHash: skill.contentHash,
                installedAt: currentAt,
                compatibility: compatibleReport(),
              },
            ],
          },
        ],
      })),
      inspectSkillUpdate: vi.fn(async () => ({
        skillId: skill.id,
        currentContentHash: skill.contentHash,
        candidate: {
          contentHash: 'b'.repeat(64),
          installedAt: '2026-07-20T15:44:29.466Z',
          compatibility: compatibleReport(),
        },
        changes: [{ path: 'references/marker.md', kind: 'modified' as const }],
        updateAvailable: true,
      })),
    };
    const fixture = await createLifecycleFixture(api);

    buttonContaining(fixture, skill.id).click();
    await fixture.whenStable();
    fixture.detectChanges();
    buttonContaining(fixture, 'Check update').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Update available');
    expect(text).toContain('references/marker.md');
    expect(text).toContain('modified');
    expect(text).toContain(formatExpectedProfileDate(retainedAt));
    expect(text).toContain(formatExpectedProfileDate(currentAt));
    expect(text).not.toContain(retainedAt);

    buttonContaining(fixture, 'references/marker.md').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.readSkillFile).toHaveBeenCalledWith(skill.id, 'references/marker.md');
    const root = fixture.nativeElement as HTMLElement;
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('references/marker.md');
    expect(dialog?.textContent).toContain('The exact marker is REFERENCE-SKILL-731.');

    buttonWithLabel(fixture, 'Close file preview').click();
    fixture.detectChanges();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });
});

async function createLifecycleFixture(
  api: Partial<AssistantApi> & { initial: SkillPackageDetails },
) {
  const profileSync = userProfileSyncMock();
  await TestBed.configureTestingModule({
    imports: [SkillSettingsPage],
    providers: [
      provideRouter([]),
      { provide: AssistantApi, useValue: api },
      { provide: UserProfileSyncService, useValue: profileSync },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(SkillSettingsPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(api.initial.id);
  });
  return fixture;
}

function lifecycleApi(initial: SkillPackageDetails, result: SkillPackageDetails) {
  return {
    initial,
    skills: vi.fn(async () => ({ skills: [initial] })),
    skillInstallations: vi.fn(async () => ({ installations: [] })),
    agents: vi.fn(async () => ({ agents: [], defaultAgentId: 'scotty' })),
    skillProposals: vi.fn(async () => ({ proposals: [] })),
    readSkill: vi.fn(async () => initial),
    cloneSkill: vi.fn(async () => result),
    updateUserSkill: vi.fn(async () => result),
    deleteSkill: vi.fn(async () => ({ deleted: true as const, skillId: initial.id })),
  };
}

function skillDetails(
  id: string,
  ownership: SkillPackageDetails['ownership'],
): SkillPackageDetails {
  return {
    id,
    name: id,
    description: 'Review invoice batches.',
    ownership,
    contentHash: 'a'.repeat(64),
    skillMarkdown: `---\nname: ${id}\ndescription: Review invoice batches.\n---\n\n# Review\n`,
    files:
      id === 'manual-reference-check'
        ? [
            { path: 'references/marker.md', sizeBytes: 41 },
            { path: 'SKILL.md', sizeBytes: 259 },
          ]
        : [{ path: 'SKILL.md', sizeBytes: 100 }],
  };
}

function compatibleReport() {
  return {
    status: 'compatible' as const,
    requiredCapabilities: [],
    missingCapabilities: [],
    unsupportedRequirements: [],
    findings: [],
  };
}

function userProfileSyncMock() {
  const profile = signal<UserProfile | null>(userProfile());

  return {
    profile,
    loadProfile: vi.fn(async () => {
      const value = userProfile();
      profile.set(value);
      return value;
    }),
  };
}

function userProfile(): UserProfile {
  return {
    name: 'Rolf',
    timeZone: 'Europe/Berlin',
    language: 'de',
    locale: 'de-DE',
    dateStyle: 'medium',
    timeStyle: 'short',
    theme: 'dark',
    agentSettings: {},
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
  };
}

function formatExpectedProfileDate(value: string): string {
  const profile = userProfile();
  return new Intl.DateTimeFormat(profile.locale, {
    dateStyle: profile.dateStyle,
    timeStyle: profile.timeStyle,
    timeZone: profile.timeZone,
  }).format(new Date(value));
}

function buttonContaining(
  fixture: ComponentFixture<SkillSettingsPage>,
  text: string,
): HTMLButtonElement {
  const root = fixture.nativeElement as HTMLElement;
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button containing ${text} was not found.`);
  return button;
}

function buttonWithLabel(
  fixture: ComponentFixture<SkillSettingsPage>,
  label: string,
): HTMLButtonElement {
  const root = fixture.nativeElement as HTMLElement;
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Button labeled ${label} was not found.`);
  return button;
}

function pendingProposal(): SkillProposalRecord {
  return {
    id: '7c85da9d-18d0-4487-b423-7ff45a6b1718',
    kind: 'create',
    state: 'pending',
    skillId: 'invoice-review',
    title: 'invoice-review',
    description: 'Review invoice batches.',
    actor: {
      agentId: 'albert',
      threadId: 'thread-1',
      evidence: 'Requested during invoice review.',
    },
    sourceContentHash: 'a'.repeat(64),
    compatibility: {
      status: 'compatible',
      requiredCapabilities: [],
      missingCapabilities: [],
      unsupportedRequirements: [],
      findings: [],
    },
    files: [{ path: 'SKILL.md', sizeBytes: 120 }],
    changes: [{ path: 'SKILL.md', kind: 'added' }],
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z',
  };
}
