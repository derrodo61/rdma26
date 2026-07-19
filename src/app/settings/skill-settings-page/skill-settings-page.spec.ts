import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import type { SkillProposalRecord } from '../../../../shared/agent-contracts';
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
