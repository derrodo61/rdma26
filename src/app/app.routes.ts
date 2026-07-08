import { Routes } from '@angular/router';

import { AgentEditPage } from './settings/agent-edit-page/agent-edit-page';
import { AgentSettingsPage } from './settings/agent-settings-page/agent-settings-page';
import { ChatPage } from './chat/chat-page/chat-page';
import { MemorySettingsPage } from './settings/memory-settings-page/memory-settings-page';
import { RunContextPage } from './settings/run-context-page/run-context-page';
import { UserProfilePage } from './settings/user-profile-page/user-profile-page';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: ChatPage,
  },
  {
    path: 'settings/agents',
    component: AgentSettingsPage,
  },
  {
    path: 'settings/agents/:agentId',
    component: AgentEditPage,
  },
  {
    path: 'settings/profile',
    component: UserProfilePage,
  },
  {
    path: 'settings/memories',
    component: MemorySettingsPage,
  },
  {
    path: 'settings/runs/:runId',
    component: RunContextPage,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
