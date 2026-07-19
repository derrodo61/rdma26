import { Component, HostListener, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideExternalLink } from '@ng-icons/lucide';

import type {
  MessageRunSummary,
  RenderedChatMessage,
  ResearchSourceSummary,
  RunActivity,
} from '../../chat-page/chat-page.types';
import { formatCost } from '../../../shared/cost-format';

@Component({
  selector: 'app-chat-message-list',
  imports: [NgIcon],
  providers: [provideIcons({ lucideExternalLink })],
  templateUrl: './chat-message-list.html',
  styleUrl: './chat-message-list.css',
})
export class ChatMessageList {
  readonly messages = input.required<readonly RenderedChatMessage[]>();
  readonly isRunning = input.required<boolean>();
  readonly runActivity = input.required<RunActivity | null>();
  readonly messageResearchSources =
    input.required<Readonly<Record<string, readonly ResearchSourceSummary[]>>>();
  readonly messageRunSummaries = input.required<Readonly<Record<string, MessageRunSummary>>>();
  protected readonly openSourcesMessageId = signal<string | null>(null);
  protected readonly inlineSource = signal<InlineSourcePopover | null>(null);
  private hideInlineSourceTimer: ReturnType<typeof setTimeout> | null = null;
  private isInlineSourcePinned = false;
  private activeInlineSourceTrigger: HTMLElement | null = null;

  protected sourcesForMessage(messageId: string): readonly ResearchSourceSummary[] {
    return this.messageResearchSources()[messageId] ?? [];
  }

  protected runSummaryForMessage(messageId: string): MessageRunSummary | null {
    return this.messageRunSummaries()[messageId] ?? null;
  }

  protected hasFooter(messageId: string): boolean {
    return (
      this.sourcesForMessage(messageId).length > 0 || Boolean(this.runSummaryForMessage(messageId))
    );
  }

  protected formatMessageCost(summary: MessageRunSummary): string {
    return summary.costs.map(({ amount, currency }) => formatCost(amount, currency)).join(' + ');
  }

  protected isSourcesOpen(messageId: string): boolean {
    return this.openSourcesMessageId() === messageId;
  }

  protected toggleSources(messageId: string): void {
    this.openSourcesMessageId.update((openMessageId) =>
      openMessageId === messageId ? null : messageId,
    );
  }

  @HostListener('mouseover', ['$event'])
  @HostListener('focusin', ['$event'])
  protected showInlineSource(event: Event): void {
    const trigger = this.readSourceTrigger(event.target);

    if (!trigger) {
      if (event.target instanceof Element && event.target.closest('.inline-source-popover')) {
        this.cancelInlineSourceHide();
      }
      return;
    }

    if (this.isInlineSourcePinned && this.inlineSource()?.url !== trigger.getAttribute('href')) {
      return;
    }

    this.cancelInlineSourceHide();
    this.setInlineSource(trigger);
  }

  @HostListener('mouseout', ['$event'])
  @HostListener('focusout', ['$event'])
  protected scheduleInlineSourceHide(event?: Event): void {
    if (this.isInlineSourcePinned) return;

    if (event instanceof MouseEvent || event instanceof FocusEvent) {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Element && nextTarget.closest('.inline-source-popover')) return;
    }

    this.cancelInlineSourceHide();
    this.hideInlineSourceTimer = setTimeout(() => this.inlineSource.set(null), 120);
  }

  protected cancelInlineSourceHide(): void {
    if (this.hideInlineSourceTimer) {
      clearTimeout(this.hideInlineSourceTimer);
      this.hideInlineSourceTimer = null;
    }
  }

  @HostListener('click', ['$event'])
  protected toggleInlineSource(event: Event): void {
    const trigger = this.readSourceTrigger(event.target);

    if (!trigger) return;

    event.preventDefault();
    const currentUrl = this.inlineSource()?.url;

    if (this.isInlineSourcePinned && currentUrl === trigger.getAttribute('href')) {
      this.closeInlineSource();
      return;
    }

    this.isInlineSourcePinned = true;
    this.cancelInlineSourceHide();
    this.setInlineSource(trigger);
  }

  protected closeInlineSource(): void {
    this.cancelInlineSourceHide();
    this.isInlineSourcePinned = false;
    this.activeInlineSourceTrigger = null;
    this.inlineSource.set(null);
  }

  protected repositionInlineSource(): void {
    if (this.activeInlineSourceTrigger?.isConnected) {
      this.setInlineSource(this.activeInlineSourceTrigger);
    }
  }

  @HostListener('document:keydown.escape')
  protected closeInlineSourceOnEscape(): void {
    this.closeInlineSource();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected closeInlineSourceOutside(event: PointerEvent): void {
    const target = event.target;

    if (
      target instanceof Element &&
      (target.closest('.source-citation') || target.closest('.inline-source-popover'))
    ) {
      return;
    }

    this.closeInlineSource();
  }

  @HostListener('window:resize')
  protected repositionInlineSourceOnResize(): void {
    this.repositionInlineSource();
  }

  private readSourceTrigger(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>('.source-citation') : null;
  }

  private setInlineSource(trigger: HTMLElement): void {
    const url = trigger.getAttribute('href');

    if (!url) return;

    this.activeInlineSourceTrigger = trigger;
    const rect = trigger.getBoundingClientRect();
    const popoverWidth = Math.min(352, globalThis.innerWidth - 24);
    const halfWidth = popoverWidth / 2;
    const left = clamp(rect.left + rect.width / 2, halfWidth + 12, innerWidth - halfWidth - 12);
    const placeAbove = rect.top >= 190;
    const domain = readUrlDomain(url);
    const label = readSourceLabel(trigger);

    this.inlineSource.set({
      url,
      title: label && label !== domain && label !== url ? label : 'Source details',
      domain,
      left,
      top: placeAbove ? rect.top - 10 : rect.bottom + 10,
      placement: placeAbove ? 'above' : 'below',
    });
  }
}

interface InlineSourcePopover {
  readonly url: string;
  readonly title: string;
  readonly domain: string;
  readonly left: number;
  readonly top: number;
  readonly placement: 'above' | 'below';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function readSourceLabel(trigger: HTMLElement): string {
  return (trigger.querySelector('.source-citation__label')?.textContent ?? '')
    .replace(/^Source:\s*/i, '')
    .trim();
}

function readUrlDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}
