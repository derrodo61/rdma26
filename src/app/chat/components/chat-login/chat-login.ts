import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-chat-login',
  imports: [FormsModule],
  templateUrl: './chat-login.html',
})
export class ChatLogin {
  readonly username = input.required<string>();
  readonly password = input.required<string>();
  readonly loginError = input.required<string | null>();

  readonly usernameChanged = output<string>();
  readonly passwordChanged = output<string>();
  readonly submitted = output<void>();
}
