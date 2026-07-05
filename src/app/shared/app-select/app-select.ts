import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideChevronDown } from '@ng-icons/lucide';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

type SelectVariant = 'default' | 'inline';

@Component({
  selector: 'app-select',
  imports: [NgIcon],
  providers: [
    provideIcons({
      lucideCheck,
      lucideChevronDown,
    }),
  ],
  template: `
    <div class="relative">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-md py-0 text-left text-sm font-medium focus:outline-none focus-visible:shadow-[var(--focus-shadow)]"
        [class.h-10]="variant() === 'default'"
        [class.border]="variant() === 'default'"
        [class.border-border]="variant() === 'default'"
        [class.bg-surface]="variant() === 'default'"
        [class.pl-3]="variant() === 'default'"
        [class.pr-2]="variant() === 'default'"
        [class.text-text]="variant() === 'default'"
        [class.shadow-sm]="variant() === 'default'"
        [class.hover:bg-surface-muted]="variant() === 'default'"
        [class.h-8]="variant() === 'inline'"
        [class.px-2]="variant() === 'inline'"
        [class.text-text-muted]="variant() === 'inline'"
        [class.hover:bg-surface-hover]="variant() === 'inline'"
        [class.hover:text-text]="variant() === 'inline'"
        aria-haspopup="listbox"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-label]="label()"
        (click)="toggle()"
        (keydown)="handleButtonKeydown($event)"
      >
        <span class="min-w-0 flex-1 truncate">{{ selectedLabel() }}</span>
        <ng-icon
          class="shrink-0 text-text-muted transition-transform"
          [class.rotate-180]="isOpen()"
          name="lucideChevronDown"
          size="16"
          strokeWidth="2"
        />
      </button>

      @if (isOpen()) {
        <div
          class="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
          role="listbox"
          [attr.aria-label]="label()"
        >
          @for (option of options(); track option.value) {
            <button
              type="button"
              class="flex h-9 w-full items-center justify-between gap-2 rounded px-2 text-left text-sm text-text hover:bg-surface-muted focus:outline-none focus-visible:bg-surface-active focus-visible:shadow-none"
              role="option"
              [attr.aria-selected]="option.value === value()"
              [class.bg-surface-active]="option.value === value()"
              (click)="choose(option.value)"
            >
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              @if (option.value === value()) {
                <ng-icon
                  class="shrink-0 text-accent"
                  name="lucideCheck"
                  size="16"
                  strokeWidth="2"
                />
              }
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class AppSelect {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly label = input.required<string>();
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = input.required<string>();
  readonly variant = input<SelectVariant>('default');
  readonly valueChange = output<string>();

  protected readonly isOpen = signal(false);
  protected readonly selectedLabel = computed(
    () =>
      this.options().find((option) => option.value === this.value())?.label ??
      this.options()[0]?.label ??
      '',
  );

  @HostListener('document:click', ['$event.target'])
  protected closeOnOutsideClick(target: EventTarget | null): void {
    if (target instanceof Node && this.elementRef.nativeElement.contains(target)) {
      return;
    }

    this.isOpen.set(false);
  }

  protected toggle(): void {
    this.isOpen.update((isOpen) => !isOpen);
  }

  protected choose(value: string): void {
    this.valueChange.emit(value);
    this.isOpen.set(false);
  }

  protected handleButtonKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.isOpen.set(false);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggle();
    }
  }
}
