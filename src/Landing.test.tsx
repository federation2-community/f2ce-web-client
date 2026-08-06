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

// happy-dom v20 doesn't ship localStorage; stub a minimal Map-backed one so the
// component's reads/writes work and the prefill/persist tests can assert.
const store = new Map<string, string>();
beforeEach(() => {
  vi.mocked(setSessionCredentials).mockClear();
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

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

  it('forgot password sends `forgot password <name>` in account and the email as password', () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }));
    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Zaphod' } });
    fireEvent.change(screen.getByLabelText(/registered email/i), { target: { value: 'z@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /temporary password/i }));

    expect(setSessionCredentials).toHaveBeenCalledWith('conn-1', {
      account: 'forgot password Zaphod',
      password: 'z@example.com',
    });
    expect(p.openProfile).toHaveBeenCalledWith('conn-1', true);
  });

  it('forgot username sends `forgot name` in account and the email as password', () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /forgot your character name\?/i }));
    fireEvent.change(screen.getByLabelText(/registered email/i), { target: { value: 'z@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email my character name/i }));

    expect(setSessionCredentials).toHaveBeenCalledWith('conn-1', {
      account: 'forgot name',
      password: 'z@example.com',
    });
    expect(p.openProfile).toHaveBeenCalledWith('conn-1', true);
  });
});
