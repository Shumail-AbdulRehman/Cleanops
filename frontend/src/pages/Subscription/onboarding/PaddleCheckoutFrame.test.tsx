import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageContext } from '@/i18n/context';
import { translate, type Language } from '@/i18n/translations';
import PaddleCheckoutFrame from './PaddleCheckoutFrame';

function frame(registerFrameTarget: (value: string | null) => void, ready = false, language: Language = 'en') {
  return <LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (key, values) => translate(key, language, values) }}>
    <PaddleCheckoutFrame ready={ready} registerFrameTarget={registerFrameTarget} />
  </LanguageContext.Provider>;
}

describe('PaddleCheckoutFrame', () => {
  it('registers the existing target once, keeps it across rerenders and language changes, and releases on unmount', () => {
    let registeredNode: Element | null = null;
    const register = vi.fn((value: string | null) => {
      if (value) registeredNode = document.querySelector(`.${value}`);
    });
    const { container, rerender, unmount } = render(frame(register));
    const target = container.querySelector('.paddle-checkout-frame')!;
    expect(registeredNode).toBe(target);
    expect(register).toHaveBeenCalledExactlyOnceWith('paddle-checkout-frame');
    rerender(frame(register));
    rerender(frame(register, false, 'ur'));
    expect(screen.getByRole('status')).toHaveTextContent(translate('Loading the secure card form', 'ur'));
    rerender(frame(register, true, 'ur'));
    expect(container.querySelector('.paddle-checkout-frame')).toBe(target);
    expect(register).toHaveBeenCalledTimes(1);
    unmount();
    expect(register.mock.calls.map(([value]) => value)).toEqual(['paddle-checkout-frame', null]);
  });

  it('shows a visible loading label and skeletons until ready, while keeping the target measurable and inactive', () => {
    const { container, rerender } = render(frame(vi.fn()));
    expect(screen.getByRole('status')).toHaveTextContent('Loading the secure card form');
    expect(container.querySelectorAll('.flow-skeleton')).toHaveLength(6);
    const target = container.querySelector('.paddle-checkout-frame')!;
    expect(target.parentElement).toHaveClass('invisible', 'opacity-0');
    expect(target.parentElement).toHaveAttribute('inert');
    expect(target.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
    const register = vi.fn();
    rerender(frame(register, true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('.flow-skeleton')).not.toBeInTheDocument();
    expect(target.parentElement).toHaveClass('flow-frame-ready');
    expect(target.parentElement).not.toHaveAttribute('inert');
    expect(target.parentElement).toHaveAttribute('aria-hidden', 'false');
    expect(container.firstChild).toHaveAttribute('aria-busy', 'false');
  });

  it('preserves provider-owned children through ready, loading and language changes without inspecting the iframe', () => {
    const register = vi.fn();
    const { container, rerender } = render(frame(register));
    const target = container.querySelector('.paddle-checkout-frame')!;
    const iframe = document.createElement('iframe');
    const inspect = vi.fn(() => { throw new Error('Cross-origin frame must not be inspected'); });
    Object.defineProperty(iframe, 'contentDocument', { get: inspect });
    Object.defineProperty(iframe, 'contentWindow', { get: inspect });
    target.appendChild(iframe);
    for (const ready of [true, false, true]) {
      rerender(frame(register, ready, 'ur'));
      expect(target.firstChild).toBe(iframe);
      expect(container.querySelector('.paddle-checkout-frame')).toBe(target);
    }
    expect(inspect).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each(['en', 'ur'] as const)('reserves space, stays LTR and allows footer growth in %s', language => {
    const { container } = render(frame(vi.fn(), true, language));
    expect(container.firstChild).toHaveAttribute('dir', 'ltr');
    expect(container.firstChild).toHaveClass('min-h-[450px]', 'min-w-[312px]', 'w-full', 'overflow-visible');
    const target = container.querySelector('.paddle-checkout-frame')!;
    expect(target).toHaveStyle({ minHeight: '450px', minWidth: '312px', width: '100%', overflow: 'visible' });
    expect((target as HTMLElement).style.height).toBe('');
    expect(target.className).toBe('paddle-checkout-frame');
  });

  it('balances registration and cleanup under StrictMode effect replay', () => {
    const register = vi.fn();
    const { rerender, unmount } = render(<StrictMode>{frame(register)}</StrictMode>);
    expect(register.mock.calls.map(([value]) => value)).toEqual(['paddle-checkout-frame', null, 'paddle-checkout-frame']);
    rerender(<StrictMode>{frame(register, true, 'ur')}</StrictMode>);
    expect(register).toHaveBeenCalledTimes(3);
    unmount();
    expect(register).toHaveBeenLastCalledWith(null);
    expect(register).toHaveBeenCalledTimes(4);
  });
});
