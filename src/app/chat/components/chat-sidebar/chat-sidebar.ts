import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';

import type {
  AuthSessionResponse,
  ChatThreadSummary,
  ThemePreference,
} from '../../../../../shared/agent-contracts';
import { AppSelect, type SelectOption } from '../../../shared/app-select/app-select';

@Component({
  selector: 'app-chat-sidebar',
  imports: [RouterLink, NgIcon, AppSelect],
  templateUrl: './chat-sidebar.html',
})
export class ChatSidebar {
  readonly isCollapsed = input.required<boolean>();
  readonly isSettingsMenuOpen = input.required<boolean>();
  readonly session = input.required<AuthSessionResponse | null>();
  readonly agentOptions = input.required<readonly SelectOption[]>();
  readonly selectedAgentId = input.required<string>();
  readonly threads = input.required<readonly ChatThreadSummary[]>();
  readonly activeThreadId = input.required<string | null>();
  readonly isRunning = input.required<boolean>();
  readonly theme = input.required<ThemePreference>();

  readonly sidebarToggled = output<void>();
  readonly threadCreated = output<void>();
  readonly threadSelected = output<string>();
  readonly threadDeleted = output<string>();
  readonly agentChanged = output<string>();
  readonly settingsMenuToggled = output<void>();
  readonly settingsMenuClosed = output<void>();
  readonly themeChanged = output<ThemePreference>();
  readonly signedOut = output<void>();

  protected stopThreadClick(event: Event): void {
    event.stopPropagation();
  }
}
