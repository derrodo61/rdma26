import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { RenderedChatMessage } from '../../chat-page/chat-page.types';
import { ChatMessageList } from './chat-message-list';

describe('ChatMessageList', () => {
  let fixture: ComponentFixture<ChatMessageList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatMessageList],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatMessageList);
    fixture.componentRef.setInput('messages', [
      assistantMessage('assistant-with-sources', 'Answer with sources.'),
      assistantMessage('assistant-without-sources', 'Answer without sources.'),
      userMessage('user-message', 'Thanks.'),
    ]);
    fixture.componentRef.setInput('isRunning', false);
    fixture.componentRef.setInput('runActivity', null);
    fixture.componentRef.setInput('messageResearchSources', {
      'assistant-with-sources': [
        {
          url: 'https://example.com/source',
          title: 'Example Source',
          domain: 'example.com',
        },
      ],
    });
    fixture.detectChanges();
  });

  it('shows a sources button only for assistant messages with sources', () => {
    const buttons = sourceButtons();

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Sources 1');
  });

  it('opens message-scoped sources with external links', () => {
    sourceButtons()[0].click();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const sourceLink = root.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/source"]',
    );

    expect(sourceLink).toBeTruthy();
    expect(sourceLink?.textContent?.trim()).toBe('Example Source');
    expect(sourceLink?.target).toBe('_blank');
    expect(sourceLink?.rel).toContain('noopener');
    expect(sourceLink?.rel).toContain('noreferrer');
    expect(root.textContent).toContain('example.com');
  });

  it('toggles the source panel closed when the sources button is clicked again', () => {
    const button = sourceButtons()[0];

    button.click();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('a[href="https://example.com/source"]')).toBeTruthy();

    button.click();
    fixture.detectChanges();

    expect(root.querySelector('a[href="https://example.com/source"]')).toBeNull();
  });

  function sourceButtons(): HTMLButtonElement[] {
    const root = fixture.nativeElement as HTMLElement;

    return [...root.querySelectorAll<HTMLButtonElement>('button')].filter((button) =>
      button.textContent?.includes('Sources'),
    );
  }
});

function assistantMessage(id: string, content: string): RenderedChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    renderedContent: `<p>${content}</p>`,
    createdAt: '2026-07-08T00:00:00.000Z',
  };
}

function userMessage(id: string, content: string): RenderedChatMessage {
  return {
    id,
    role: 'user',
    content,
    renderedContent: '',
    createdAt: '2026-07-08T00:00:00.000Z',
  };
}
