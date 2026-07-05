import { Routes } from '@angular/router';

import { AgentSettingsPage } from './settings/agent-settings-page/agent-settings-page';
import { ChatPage } from './chat/chat-page/chat-page';

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
    path: '**',
    redirectTo: '',
  },
];
