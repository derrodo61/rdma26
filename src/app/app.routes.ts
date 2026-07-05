import { Routes } from '@angular/router';

import { AgentEditPage } from './settings/agent-edit-page/agent-edit-page';
import { AgentSettingsPage } from './settings/agent-settings-page/agent-settings-page';
import { ChatPage } from './chat/chat-page/chat-page';
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
    path: '**',
    redirectTo: '',
  },
];
