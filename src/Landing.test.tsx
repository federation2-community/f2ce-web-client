// @vitest-environment jsdom
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

  it('opens a fresh connection with no staged credentials for a new character', () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /create a new character/i }));

    expect(p.ensureBrandProfile).toHaveBeenCalledWith();
    expect(p.openProfile).toHaveBeenCalledWith('conn-1', true);
    expect(setSessionCredentials).toHaveBeenCalledWith('conn-1', null);
    // No login credentials were ever submitted on this path.
    expect(setSessionCredentials).not.toHaveBeenCalledWith('conn-1', expect.objectContaining({ password: expect.anything() }));
  });
});
