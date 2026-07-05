import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ThemePreferenceService } from './settings/theme-preference';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor() {
    inject(ThemePreferenceService);
  }
}
