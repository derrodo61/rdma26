import type { MemoryMaintenanceSettings } from '../../../shared/agent-contracts';
import type { AssistantRuntime } from '../runtime';

export class MemoryMaintenanceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly runtime: AssistantRuntime,
    private readonly onInfo: (message: string) => void,
    private readonly onError: (message: string) => void,
  ) {}

  async start(): Promise<void> {
    this.applySettings(await this.runtime.readMemoryMaintenanceSettings());
  }

  async refresh(): Promise<void> {
    this.applySettings(await this.runtime.readMemoryMaintenanceSettings());
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private applySettings(settings: MemoryMaintenanceSettings): void {
    this.stop();

    if (!settings.enabled) {
      this.onInfo('Memory maintenance scheduler is disabled.');
      return;
    }

    const intervalMs = settings.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runScheduledMaintenance();
    }, intervalMs);
    this.timer.unref();
    this.onInfo(`Memory maintenance scheduler enabled every ${settings.intervalMinutes} minutes.`);
  }

  private async runScheduledMaintenance(): Promise<void> {
    if (this.isRunning) {
      this.onInfo('Memory maintenance scheduler skipped because a run is already active.');
      return;
    }

    this.isRunning = true;
    const startedAt = new Date().toISOString();

    try {
      const settings = await this.runtime.readMemoryMaintenanceSettings();

      if (!settings.enabled) {
        return;
      }

      await this.runtime.recordMemoryMaintenanceStarted(startedAt);
      const result = await this.runtime.runMemoryMaintenance({
        agentId: settings.agentId,
        model: settings.model,
        limitPerAgent: settings.limitPerAgent,
      });
      await this.runtime.recordMemoryMaintenanceFinished(result.finishedAt);
      const summaryCount = result.agents.reduce(
        (total, agentResult) => total + agentResult.summaries.length,
        0,
      );
      this.onInfo(`Memory maintenance scheduler updated ${summaryCount} thread memories.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Memory maintenance failed.';
      await this.runtime.recordMemoryMaintenanceFailed(message);
      this.onError(message);
    } finally {
      this.isRunning = false;
    }
  }
}
