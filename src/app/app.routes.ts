import { Routes } from '@angular/router';

import { ChatPage } from './chat/chat-page/chat-page';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: ChatPage,
  },
  {
    path: 'settings/agents',
    loadComponent: () =>
      import('./settings/agent-settings-page/agent-settings-page').then(
        (module) => module.AgentSettingsPage,
      ),
  },
  {
    path: 'settings/agents/:agentId',
    loadComponent: () =>
      import('./settings/agent-edit-page/agent-edit-page').then((module) => module.AgentEditPage),
  },
  {
    path: 'settings/profile',
    loadComponent: () =>
      import('./settings/user-profile-page/user-profile-page').then(
        (module) => module.UserProfilePage,
      ),
  },
  {
    path: 'settings/memories',
    loadComponent: () =>
      import('./settings/memory-settings-page/memory-settings-page').then(
        (module) => module.MemorySettingsPage,
      ),
  },
  {
    path: 'settings/runs/:runId',
    loadComponent: () =>
      import('./settings/run-context-page/run-context-page').then(
        (module) => module.RunContextPage,
      ),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
