import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageContext } from '@/i18n/context';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import FlowShell, { type FlowShellProps, type FlowStep } from './FlowShell';

function renderShell(props: Partial<FlowShellProps> = {}) {
  return render(<MemoryRouter><LanguageProvider><FlowShell {...props}>{props.children ?? <h1>Screen heading</h1>}</FlowShell></LanguageProvider></MemoryRouter>);
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.dir = 'ltr';
  document.documentElement.lang = 'en';
});

describe('worksheet progress', () => {
  it.each<FlowStep>(['account', 'plan', 'payment', 'workspace'])('%s marks only earlier steps complete, one current step and its finished sheet edges', (step) => {
    const { container } = renderShell({ step });
    const progress = screen.getByRole('navigation', { name: 'Setup progress' });
    const items = within(progress).getAllByRole('listitem');
    const index = ['account', 'plan', 'payment', 'workspace'].indexOf(step);
    expect(items).toHaveLength(4);
    expect(items.map((item) => within(item).getByText(/^(Account|Plan|Card|Workspace)$/).textContent)).toEqual(['Account', 'Plan', 'Card', 'Workspace']);
    items.forEach((item, position) => {
      if (position === index) expect(item).toHaveAttribute('aria-current', 'step');
      else expect(item).not.toHaveAttribute('aria-current');
      if (position < index) {
        expect(item).toHaveAttribute('data-complete', 'true');
        expect(within(item).getByText('Step completed')).toBeInTheDocument();
      } else {
        expect(item).not.toHaveAttribute('data-complete');
        expect(within(item).queryByText('Step completed')).not.toBeInTheDocument();
      }
    });
    expect(progress.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelectorAll('.flow-edge[data-visible="true"]')).toHaveLength(index);
    expect(container.querySelector('.flow-stack')).toHaveAttribute('aria-hidden', 'true');
  });

  it('omits progress and finished edges for a screen outside setup', () => {
    const { container } = renderShell({ step: 'none' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.flow-edge[data-visible="true"]')).toHaveLength(0);
  });

  it('finishes all four ticks on the ready sheet, retaining the three prior sheets from the prototype', () => {
    const { container } = renderShell({ step: 'done' });
    const progress = screen.getByRole('navigation', { name: 'Setup progress' });
    expect(progress.querySelectorAll('[data-complete="true"]')).toHaveLength(4);
    expect(progress.querySelector('[aria-current]')).toBeNull();
    expect(within(progress).getAllByText('Step completed')).toHaveLength(4);
    expect(container.querySelectorAll('.flow-edge[data-visible="true"]')).toHaveLength(3);
  });

  it('advances and reverses ticks and edges without replacing their DOM', () => {
    const shell = (step: FlowStep) => <MemoryRouter><FlowShell step={step}><h1>Heading</h1></FlowShell></MemoryRouter>;
    const view = render(shell('account'));
    const firstTick = view.container.querySelector('.flow-step-box path');
    const firstEdge = view.container.querySelector('.flow-edge');
    view.rerender(shell('workspace'));
    expect(view.container.querySelectorAll('.flow-edge[data-visible="true"]')).toHaveLength(3);
    expect(view.container.querySelectorAll('[data-complete="true"]')).toHaveLength(3);
    view.rerender(shell('plan'));
    expect(view.container.querySelectorAll('.flow-edge[data-visible="true"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-complete="true"]')).toHaveLength(1);
    expect(view.container.querySelector('.flow-edge')).toBe(firstEdge);
    expect(view.container.querySelector('.flow-step-box path')).toBe(firstTick);
  });
});

describe('frame composition', () => {
  it.each<NonNullable<FlowShellProps['size']>>(['narrow', 'split', 'plan', 'wide'])('uses the %s size for both the sheet and its stack container', (size) => {
    const { container } = renderShell({ size, step: 'account' });
    expect(screen.getByRole('main')).toHaveAttribute('data-size', size);
    expect(container.querySelector('.flow-stage')).toHaveAttribute('data-size', size);
  });

  it.each([undefined, false, true])('shows Test mode only for an explicit true (%s)', (testMode) => {
    renderShell({ testMode });
    if (testMode) expect(screen.getByText('Test mode')).toBeVisible();
    else expect(screen.queryByText('Test mode')).not.toBeInTheDocument();
    expect(screen.queryByText(/card number|preview|sample price/i)).not.toBeInTheDocument();
  });

  it('reuses the brand, language control and focusable skip destination', () => {
    const { container } = renderShell();
    const main = screen.getByRole('main');
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(document.getElementById(skip.getAttribute('href')!.slice(1))).toBe(main);
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: 'Hygene Ops sign in' })).toHaveAttribute('href', '/login');
    expect(container.querySelector('.hygene-mark')).toHaveAttribute('src', '/brand/hygene-ops-mark.svg');
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.flow-supergraphic')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.flow-supergraphic')).toHaveAttribute('focusable', 'false');
  });

  it('gives each shell its own skip destination', () => {
    render(<MemoryRouter><FlowShell><h1>First</h1></FlowShell><FlowShell><h1>Second</h1></FlowShell></MemoryRouter>);
    const links = screen.getAllByRole('link', { name: 'Skip to content' });
    const mains = screen.getAllByRole('main');
    expect(mains[0].id).not.toBe(mains[1].id);
    links.forEach((link, index) => expect(link).toHaveAttribute('href', `#${mains[index].id}`));
  });

  it('composes screen-owned split content with existing form primitives', () => {
    renderShell({ size: 'split', step: 'account', aside: <p>Screen-owned worksheet</p>, children: <><h1>Account</h1><Input aria-label="Company" /><Button className="flow-button">Continue</Button></> });
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveAttribute('data-slot', 'input');
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveAttribute('data-slot', 'button');
    expect(within(screen.getByRole('complementary')).getByText('Screen-owned worksheet')).toBeInTheDocument();
  });

  it.each(['narrow', 'plan', 'wide'] as const)('does not add a side panel to %s', (size) => {
    renderShell({ size, aside: <p>Worksheet</p> });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it.each([320, 390, 768, 1440])('keeps the responsive and RTL layout hooks at %ipx without assuming JSDOM measures CSS', (width) => {
    vi.stubGlobal('innerWidth', width);
    try {
      const { container } = renderShell({ size: 'split', step: 'account', aside: <p>Worksheet</p> });
      fireEvent.click(screen.getByRole('button', { name: 'اردو' }));
      expect(container.querySelector('.flow-shell')).toHaveAttribute('dir', 'rtl');
      expect(container.querySelector('.flow-shell')).toHaveAttribute('lang', 'ur-PK');
      expect(screen.getByRole('main')).toHaveAttribute('data-size', 'split');
      expect(container.querySelector('.flow-panel')).toBeInTheDocument();
      expect(container.querySelector('.flow-steps ol')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('focus and state continuity', () => {
  it('focuses the heading on entry and on step change without remounting content', () => {
    const mounted = vi.fn();
    function Content() {
      useEffect(() => { mounted(); }, []);
      const [draft, setDraft] = useState('');
      return <><h1>Heading</h1><Input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></>;
    }
    const shell = (step: FlowStep) => <MemoryRouter><FlowShell step={step}><Content /></FlowShell></MemoryRouter>;
    const view = render(shell('account'));
    const heading = screen.getByRole('heading');
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
    const draft = screen.getByRole('textbox');
    act(() => draft.focus());
    fireEvent.change(draft, { target: { value: 'Still here' } });
    view.rerender(shell('plan'));
    expect(heading).toHaveFocus();
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveValue('Still here');
    expect(mounted).toHaveBeenCalledOnce();
  });

  it('does not steal focus on a same-step rerender', () => {
    const shell = () => <MemoryRouter><FlowShell step="payment"><h1>Card</h1><Input aria-label="Draft" /></FlowShell></MemoryRouter>;
    const view = render(shell());
    const input = screen.getByRole('textbox');
    act(() => input.focus());
    view.rerender(shell());
    expect(input).toHaveFocus();
  });

  it('keeps focused content and its identity when language changes', () => {
    const shell = (language: 'en' | 'ur') => <MemoryRouter><LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}><FlowShell step="payment"><h1>Card</h1><Input aria-label="Draft" /></FlowShell></LanguageContext.Provider></MemoryRouter>;
    const view = render(shell('en'));
    const input = screen.getByRole('textbox');
    act(() => input.focus());
    view.rerender(shell('ur'));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveFocus();
    expect(view.container.querySelector('.flow-shell')).toHaveAttribute('dir', 'rtl');
  });

  it('focuses the sheet when a screen has no heading yet', () => {
    renderShell({ children: <p role="status">Loading</p> });
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
