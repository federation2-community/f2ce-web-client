// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { setSessionCredentials } from '@mudlet/mudlet-web';
import type { LandingProps } from '@mudlet/mudlet-web';
import { Landing } from './Landing';

vi.mock('@mudlet/mudlet-web', () => ({
  setSessionCredentials: vi.fn(),
}));

const props = (): LandingProps => ({
  connections: [],
  openProfile: vi.fn(),
  ensureBrandProfile: vi.fn(() => 'conn-1'),
  openSettings: vi.fn(),
});

beforeEach(() => {
  vi.mocked(setSessionCredentials).mockClear();
  localStorage.clear();
});

afterEach(cleanup);

describe('Landing', () => {
  it('logs in a returning player with the entered name and password', () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Zaphod' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(p.ensureBrandProfile).toHaveBeenCalledWith('Zaphod');
    expect(p.openProfile).toHaveBeenCalledWith('conn-1', true);
    expect(setSessionCredentials).toHaveBeenCalledWith('conn-1', { account: 'Zaphod', password: 'secret' });
  });

  it('remembers the last character name and prefills it', () => {
    localStorage.setItem('f2ce:lastCharacter', 'Trillian');
    render(<Landing {...props()} />);
    expect((screen.getByLabelText(/character name/i) as HTMLInputElement).value).toBe('Trillian');
  });

  it('persists the character name on login', () => {
    const p = props();
    render(<Landing {...p} />);
    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Ford' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(localStorage.getItem('f2ce:lastCharacter')).toBe('Ford');
  });

  it('new-character auto-answers the Login: prompt with `new` and no password', () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /create a new character/i }));

    expect(p.ensureBrandProfile).toHaveBeenCalledWith();
    expect(p.openProfile).toHaveBeenCalledWith('conn-1', true);
    expect(setSessionCredentials).toHaveBeenCalledWith('conn-1', { account: 'new', password: '' });
  });
});
