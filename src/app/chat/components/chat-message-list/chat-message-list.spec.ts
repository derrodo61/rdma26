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
    fixture.componentRef.setInput('messageRunSummaries', {
      'assistant-with-sources': {
        model: 'chatgpt:gpt-5.4',
        costs: [{ amount: 0.123456, currency: 'USD' }],
      },
    });
    fixture.detectChanges();
  });

  it('shows a sources button only for assistant messages with sources', () => {
    const buttons = sourceButtons();

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Sources 1');
  });

  it('shows the response cost with at most three decimal places', () => {
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Cost $0.123');
    expect(root.textContent).not.toContain('$0.123456');
  });

  it('shows the model used for the response', () => {
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Model chatgpt:gpt-5.4');
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

  it('relies on Angular sanitization for rendered assistant markdown', () => {
    fixture.componentRef.setInput('messages', [
      assistantMessage(
        'unsafe-assistant',
        '<img src=x onerror="globalThis.__xss = true"><script>globalThis.__xss = true</script><a href="javascript:alert(1)">bad</a>',
      ),
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(root.querySelector('a')?.getAttribute('href')).toBe('unsafe:javascript:alert(1)');
  });

  it('shows inline source details on hover and offers an external link', () => {
    fixture.componentRef.setInput('messages', [
      assistantMessage(
        'assistant-citation',
        '<p>Supported by <a class="source-citation" href="https://example.com/report"><span class="source-citation__label">Source: Example report</span></a>.</p>',
      ),
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('.source-citation');
    trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    const popover = root.querySelector<HTMLElement>('.inline-source-popover');
    const openLink = popover?.querySelector<HTMLAnchorElement>('a');

    expect(popover?.textContent).toContain('Example report');
    expect(popover?.textContent).toContain('example.com');
    expect(popover?.textContent).toContain('https://example.com/report');
    expect(openLink?.href).toBe('https://example.com/report');
    expect(openLink?.target).toBe('_blank');
  });

  it('closes the inline source popover with Escape', () => {
    fixture.componentRef.setInput('messages', [
      assistantMessage(
        'assistant-citation',
        '<a class="source-citation" href="https://example.com/report"><span class="source-citation__label">Source: Example report</span></a>',
      ),
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root
      .querySelector<HTMLButtonElement>('.source-citation')
      ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('.inline-source-popover')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(root.querySelector('.inline-source-popover')).toBeNull();
  });

  it('keeps a hovered source popover open when its trigger is clicked', () => {
    fixture.componentRef.setInput('messages', [
      assistantMessage(
        'assistant-citation',
        '<a class="source-citation" href="https://example.com/report"><span class="source-citation__label">Source: Example report</span></a>',
      ),
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLAnchorElement>('.source-citation');
    trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    trigger?.click();
    fixture.detectChanges();

    expect(root.querySelector('.inline-source-popover')).toBeTruthy();
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
