import { Routes } from '@angular/router';

import { ChatPage } from './chat/chat-page/chat-page';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: ChatPage,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
