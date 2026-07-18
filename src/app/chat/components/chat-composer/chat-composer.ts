import { Component, effect, ElementRef, input, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';

import { AppSelect, type SelectOption } from '../../../shared/app-select/app-select';

@Component({
  selector: 'app-chat-composer',
  imports: [FormsModule, RouterLink, NgIcon, AppSelect],
  templateUrl: './chat-composer.html',
  styleUrl: './chat-composer.css',
})
export class ChatComposer {
  readonly draft = input.required<string>();
  readonly error = input.required<string | null>();
  readonly latestRunId = input.required<string | null>();
  readonly canSend = input.required<boolean>();
  readonly modelOptions = input.required<readonly SelectOption[]>();
  readonly selectedModel = input.required<string>();

  readonly draftChanged = output<string>();
  readonly modelChanged = output<string>();
  readonly sent = output<void>();

  private readonly composerInput = viewChild<ElementRef<HTMLTextAreaElement>>('composerInput');

  constructor() {
    effect(() => {
      this.draft();
      queueMicrotask(() => this.resizeComposerInput());
    });
  }

  protected updateDraft(value: string): void {
    this.draftChanged.emit(value);
    queueMicrotask(() => this.resizeComposerInput());
  }

  protected handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();
    this.sent.emit();
  }

  private resizeComposerInput(): void {
    const input = this.composerInput()?.nativeElement;

    if (!input) {
      return;
    }

    if (!this.draft().trim()) {
      input.style.height = '';
      input.scrollTop = 0;
      return;
    }

    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }
}
