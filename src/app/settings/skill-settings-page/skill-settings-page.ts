import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideCheck,
  lucideDownload,
  lucideExternalLink,
  lucidePin,
  lucideRefreshCw,
  lucideRotateCcw,
  lucideSearch,
  lucideX,
} from '@ng-icons/lucide';

import type {
  AgentProfile,
  CatalogSkillSummary,
  InstallSkillRequest,
  SkillInstallationRecord,
  SkillInstalledVersion,
  SkillPackageDetails,
  SkillPackageSummary,
  SkillProposalRecord,
  SkillUpdatePreview,
} from '../../../../shared/agent-contracts';
import { AssistantApi } from '../../chat/assistant-api';

type InstallSourceType = InstallSkillRequest['sourceType'];

@Component({
  selector: 'app-skill-settings-page',
  imports: [FormsModule, RouterLink, NgIcon],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideCheck,
      lucideDownload,
      lucideExternalLink,
      lucidePin,
      lucideRefreshCw,
      lucideRotateCcw,
      lucideSearch,
      lucideX,
    }),
  ],
  templateUrl: './skill-settings-page.html',
})
export class SkillSettingsPage {
  private readonly api = inject(AssistantApi);

  protected readonly skills = signal<readonly SkillPackageSummary[]>([]);
  protected readonly installations = signal<readonly SkillInstallationRecord[]>([]);
  protected readonly agents = signal<readonly AgentProfile[]>([]);
  protected readonly proposals = signal<readonly SkillProposalRecord[]>([]);
  protected readonly selectedSkillId = signal<string | null>(null);
  protected readonly selectedProposalId = signal<string | null>(null);
  protected readonly selectedSkill = signal<SkillPackageDetails | null>(null);
  protected readonly updatePreview = signal<SkillUpdatePreview | null>(null);
  protected readonly libraryQuery = signal('');
  protected readonly installSourceType = signal<InstallSourceType>('local-directory');
  protected readonly sourcePath = signal('');
  protected readonly repositoryUrl = signal('');
  protected readonly packagePath = signal('');
  protected readonly revision = signal('');
  protected readonly catalogQuery = signal('');
  protected readonly catalogResults = signal<readonly CatalogSkillSummary[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isWorking = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly filteredSkills = computed(() => {
    const query = this.libraryQuery().trim().toLocaleLowerCase();

    if (!query) {
      return this.skills();
    }

    return this.skills().filter((skill) =>
      `${skill.name} ${skill.id} ${skill.description}`.toLocaleLowerCase().includes(query),
    );
  });

  protected readonly selectedInstallation = computed(() =>
    this.installations().find((record) => record.skillId === this.selectedSkillId()),
  );

  protected readonly selectedProposal = computed(() =>
    this.proposals().find((proposal) => proposal.id === this.selectedProposalId()),
  );

  protected readonly openProposalCount = computed(
    () =>
      this.proposals().filter((proposal) =>
        ['pending', 'quarantined', 'stale'].includes(proposal.state),
      ).length,
  );

  protected readonly selectedAttachmentAgents = computed(() => {
    const skillId = this.selectedSkillId();
    return skillId ? this.agents().filter((agent) => agent.attachedSkills.includes(skillId)) : [];
  });

  constructor() {
    void this.load();
  }

  protected updateLibraryQuery(value: string): void {
    this.libraryQuery.set(value);
  }

  protected updateInstallSourceType(value: InstallSourceType): void {
    this.installSourceType.set(value);
    this.clearMessages();
  }

  protected async selectSkill(skillId: string): Promise<void> {
    this.selectedProposalId.set(null);
    this.selectedSkillId.set(skillId);
    this.updatePreview.set(null);
    await this.run(async () => {
      this.selectedSkill.set(await this.api.readSkill(skillId));
    });
  }

  protected selectProposal(proposalId: string): void {
    this.selectedSkillId.set(null);
    this.selectedSkill.set(null);
    this.updatePreview.set(null);
    this.selectedProposalId.set(proposalId);
    this.clearMessages();
  }

  protected async applyProposal(proposal: SkillProposalRecord): Promise<void> {
    if (
      !globalThis.confirm(`Apply the reviewed ${proposal.kind} proposal for ${proposal.skillId}?`)
    ) {
      return;
    }

    await this.run(async () => {
      const updated = await this.api.applySkillProposal(proposal.id);
      await this.refreshLibrary();
      this.selectedProposalId.set(updated.id);
      this.notice.set(`Applied proposal for ${updated.skillId}.`);
    });
  }

  protected async rejectProposal(proposal: SkillProposalRecord): Promise<void> {
    const reason = globalThis.prompt('Reason for rejection', 'Rejected after review.');
    if (reason === null) {
      return;
    }

    await this.run(async () => {
      const updated = await this.api.rejectSkillProposal(proposal.id, reason.trim() || undefined);
      await this.refreshLibrary();
      this.selectedProposalId.set(updated.id);
      this.notice.set(`Rejected proposal for ${updated.skillId}.`);
    });
  }

  protected canRejectProposal(proposal: SkillProposalRecord): boolean {
    return ['pending', 'quarantined', 'stale'].includes(proposal.state);
  }

  protected async install(): Promise<void> {
    const request = this.installRequest();

    if (!request) {
      this.error.set('Complete the required source fields before installing.');
      return;
    }

    await this.run(async () => {
      const record = await this.api.installSkill(request);
      await this.refreshLibrary();
      this.selectedSkillId.set(record.skillId);
      this.selectedSkill.set(await this.api.readSkill(record.skillId));
      this.notice.set(`Installed ${record.skillId}.`);
    });
  }

  protected async searchCatalog(): Promise<void> {
    const query = this.catalogQuery().trim();

    if (!query) {
      this.error.set('Enter a catalog search term.');
      return;
    }

    await this.run(async () => {
      const response = await this.api.searchSkillCatalog(query);
      this.catalogResults.set(response.results);
    });
  }

  protected async installCatalogSkill(result: CatalogSkillSummary): Promise<void> {
    await this.run(async () => {
      const record = await this.api.installSkill({
        sourceType: 'clawhub',
        slug: result.skillId,
        version: result.version,
      });
      await this.refreshLibrary();
      this.selectedSkillId.set(record.skillId);
      this.selectedSkill.set(await this.api.readSkill(record.skillId));
      this.notice.set(`Installed ${record.skillId}.`);
    });
  }

  protected async inspectUpdate(skillId: string): Promise<void> {
    await this.run(async () => {
      this.updatePreview.set(await this.api.inspectSkillUpdate(skillId));
    });
  }

  protected async applyUpdate(preview: SkillUpdatePreview): Promise<void> {
    if (!globalThis.confirm(`Apply the inspected update to ${preview.skillId}?`)) {
      return;
    }

    await this.run(async () => {
      await this.api.applySkillUpdate(preview.skillId, {
        expectedContentHash: preview.candidate.contentHash,
      });
      this.updatePreview.set(null);
      await this.refreshLibrary();
      this.notice.set(`Updated ${preview.skillId}.`);
    });
  }

  protected async setPinned(record: SkillInstallationRecord): Promise<void> {
    await this.run(async () => {
      await this.api.setSkillPinned(record.skillId, { pinned: !record.pinned });
      await this.refreshLibrary();
      this.notice.set(record.pinned ? `Unpinned ${record.skillId}.` : `Pinned ${record.skillId}.`);
    });
  }

  protected async rollback(
    record: SkillInstallationRecord,
    version: SkillInstalledVersion,
  ): Promise<void> {
    if (!globalThis.confirm(`Restore this retained version of ${record.skillId}?`)) {
      return;
    }

    await this.run(async () => {
      await this.api.rollbackSkill(record.skillId, { contentHash: version.contentHash });
      await this.refreshLibrary();
      this.notice.set(`Restored ${record.skillId}.`);
    });
  }

  protected installationFor(skillId: string): SkillInstallationRecord | undefined {
    return this.installations().find((record) => record.skillId === skillId);
  }

  protected activeVersion(record: SkillInstallationRecord): SkillInstalledVersion | undefined {
    return record.versions.find((version) => version.contentHash === record.activeContentHash);
  }

  protected attachmentCount(skillId: string): number {
    return this.agents().filter((agent) => agent.attachedSkills.includes(skillId)).length;
  }

  protected selectedAttachmentLabel(): string {
    const agents = this.selectedAttachmentAgents();
    return agents.length ? agents.map((agent) => agent.name).join(', ') : 'No agents';
  }

  protected sourceLabel(record: SkillInstallationRecord): string {
    const source = record.source;
    return source.catalogId ?? source.url ?? source.path ?? source.type;
  }

  private installRequest(): InstallSkillRequest | null {
    const sourceType = this.installSourceType();

    switch (sourceType) {
      case 'local-directory':
      case 'local-archive': {
        const path = this.sourcePath().trim();
        return path ? { sourceType, path } : null;
      }
      case 'git': {
        const repositoryUrl = this.repositoryUrl().trim();
        return repositoryUrl
          ? {
              sourceType: 'git',
              repositoryUrl,
              packagePath: this.packagePath().trim() || undefined,
              revision: this.revision().trim() || undefined,
            }
          : null;
      }
      case 'clawhub':
        return null;
    }
  }

  private async load(): Promise<void> {
    await this.run(async () => {
      await this.refreshLibrary();
    });
    this.isLoading.set(false);
  }

  private async refreshLibrary(): Promise<void> {
    const [skills, installations, agents, proposals] = await Promise.all([
      this.api.skills(),
      this.api.skillInstallations(),
      this.api.agents(),
      this.api.skillProposals(),
    ]);
    this.skills.set(skills.skills);
    this.installations.set(installations.installations);
    this.agents.set(agents.agents);
    this.proposals.set(proposals.proposals);

    const selectedId = this.selectedSkillId();
    if (selectedId && !skills.skills.some((skill) => skill.id === selectedId)) {
      this.selectedSkillId.set(null);
      this.selectedSkill.set(null);
    }
  }

  private async run(work: () => Promise<void>): Promise<void> {
    try {
      this.isWorking.set(true);
      this.clearMessages();
      await work();
    } catch (error) {
      this.error.set(getErrorMessage(error));
    } finally {
      this.isWorking.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as unknown;
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
    ) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : 'Skill request failed.';
}
