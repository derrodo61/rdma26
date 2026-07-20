import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import type { SkillPackageDetails, SkillProposalRecord } from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';
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

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [SkillSettingsPage],
      providers: [provideRouter([]), { provide: AssistantApi, useValue: api }],
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
});

async function createLifecycleFixture(api: ReturnType<typeof lifecycleApi>) {
  await TestBed.configureTestingModule({
    imports: [SkillSettingsPage],
    providers: [provideRouter([]), { provide: AssistantApi, useValue: api }],
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
    files: [{ path: 'SKILL.md', sizeBytes: 100 }],
  };
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
