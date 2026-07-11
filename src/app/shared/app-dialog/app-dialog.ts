import { Component, ElementRef, HostListener, input, output, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';

@Component({
  selector: 'app-dialog',
  imports: [NgIcon],
  providers: [provideIcons({ lucideX })],
  template: `
    <dialog
      #dialog
      class="app-dialog w-[min(48rem,calc(100%-2rem))] border border-border bg-surface p-0 text-text shadow-xl"
      [attr.aria-label]="title()"
      (cancel)="handleCancel($event)"
      (close)="handleClose()"
    >
      <header class="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <h2 class="min-w-0 truncate text-base font-semibold">{{ title() }}</h2>
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center text-text-muted hover:bg-surface-muted hover:text-text focus:outline-none focus-visible:shadow-[var(--focus-shadow)]"
          aria-label="Close dialog"
          (click)="close()"
        >
          <ng-icon name="lucideX" size="18" strokeWidth="2" />
        </button>
      </header>

      <div class="max-h-[70dvh] overflow-y-auto p-5">
        <ng-content />
      </div>

      <footer class="flex justify-end gap-2 border-t border-border px-5 py-4">
        <ng-content select="[dialog-actions]" />
      </footer>
    </dialog>
  `,
  styles: `
    .app-dialog {
      margin: auto;
    }

    .app-dialog::backdrop {
      background: rgb(0 0 0 / 65%);
    }
  `,
})
export class AppDialog {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly title = input.required<string>();
  readonly closed = output<void>();

  open(): void {
    const dialog = this.dialog().nativeElement;

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  close(): void {
    const dialog = this.dialog().nativeElement;

    if (dialog.open) {
      dialog.close();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected closeOnEscape(event: Event): void {
    if (!this.dialog().nativeElement.open) {
      return;
    }

    event.preventDefault();
    this.close();
  }

  protected handleClose(): void {
    this.closed.emit();
  }

  protected handleCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }
}
