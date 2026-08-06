// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

import { setSessionCredentials } from '@mudlet/mudlet-web';
import type { LandingProps } from '@mudlet/mudlet-web';
import { Landing } from './Landing';

// Minimal fake of mudlet-web's EventBus + MudSession, just enough for
// Landing's headless forgot flow: `new MudSession()`, `.events.on(...)`,
// `.connect(url)`, `.sendCharLoginCredentials(...)`, `.disconnect()`,
// `.destroy()`. Tests drive it by calling `session.events.emit(...)`
// directly, mirroring what a real `charLogin.request`/`charLogin.result`
// from the engine would do.
const { mockSessions, MockMudSession } = vi.hoisted(() => {
  class MockEventBus {
    listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(handler);
      return () => this.listeners.get(event)?.delete(handler);
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((handler) => handler(...args));
    }
  }

  class MockMudSession {
    events = new MockEventBus();
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();
    sendCharLoginCredentials = vi.fn();
  }

  const mockSessions: MockMudSession[] = [];
  return { mockSessions, MockMudSession };
});

vi.mock('@mudlet/mudlet-web', () => ({
  setSessionCredentials: vi.fn(),
  MudSession: vi.fn().mockImplementation(() => {
    const session = new MockMudSession();
    mockSessions.push(session);
    return session;
  }),
}));

vi.mock('./env', () => ({
  readEnv: () => ({
    VITE_WS_URL: 'wss://ws-test.federation2.com/',
    VITE_PKG_URL: '',
    VITE_PKG_VERSION: '',
    showDevToolbar: false,
  }),
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
  mockSessions.length = 0;
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
    // Login never touches the headless-session path.
    expect(mockSessions).toHaveLength(0);
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
    expect(mockSessions).toHaveLength(0);
  });

  it('forgot password drives a headless MudSession with the right credentials and shows the confirmation, not an error modal', async () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }));
    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Zaphod' } });
    fireEvent.change(screen.getByLabelText(/registered email/i), { target: { value: 'z@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /temporary password/i }));

    // Never touches the login/openProfile path.
    expect(p.openProfile).not.toHaveBeenCalled();
    expect(p.ensureBrandProfile).not.toHaveBeenCalled();
    expect(setSessionCredentials).not.toHaveBeenCalled();

    expect(mockSessions).toHaveLength(1);
    const session = mockSessions[0];
    expect(session.connect).toHaveBeenCalledWith('wss://ws-test.federation2.com/');

    // Engine requests credentials; Landing replies with the forgot payload.
    session.events.emit('charLogin.request', ['password-credentials']);
    expect(session.sendCharLoginCredentials).toHaveBeenCalledWith('forgot password Zaphod', 'z@example.com');

    // Engine's friendly, non-error result renders as a plain confirmation.
    const message = "If that character name and email match, we've emailed a temporary password.";
    session.events.emit('charLogin.result', { success: false, message });

    const notice = await waitFor(() => screen.getByRole('status'));
    expect(notice.textContent).toBe(message);
    expect(screen.queryByText(/error/i)).toBeNull();
    expect(session.disconnect).toHaveBeenCalled();
    expect(session.destroy).toHaveBeenCalled();
  });

  it('forgot username drives a headless MudSession with `forgot name` and shows the confirmation', async () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /forgot your character name\?/i }));
    fireEvent.change(screen.getByLabelText(/registered email/i), { target: { value: 'z@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email my character name/i }));

    expect(p.openProfile).not.toHaveBeenCalled();
    expect(mockSessions).toHaveLength(1);
    const session = mockSessions[0];

    session.events.emit('charLogin.request', ['password-credentials']);
    expect(session.sendCharLoginCredentials).toHaveBeenCalledWith('forgot name', 'z@example.com');

    const message = "If that email is registered, we've emailed the character name(s).";
    session.events.emit('charLogin.result', { success: false, message });

    const notice = await waitFor(() => screen.getByRole('status'));
    expect(notice.textContent).toBe(message);
    expect(session.disconnect).toHaveBeenCalled();
    expect(session.destroy).toHaveBeenCalled();
  });

  it('shows a generic notice and cleans up if the server never responds', async () => {
    vi.useFakeTimers();
    try {
      const p = props();
      render(<Landing {...p} />);

      fireEvent.click(screen.getByRole('button', { name: /forgot your character name\?/i }));
      fireEvent.change(screen.getByLabelText(/registered email/i), { target: { value: 'z@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /email my character name/i }));

      const session = mockSessions[0];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });

      expect(screen.getByRole('status').textContent).toMatch(/couldn't reach the server/i);
      expect(session.disconnect).toHaveBeenCalled();
      expect(session.destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('going back to log in and reopening a forgot form clears a prior notice', async () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /forgot your character name\?/i }));
    fireEvent.change(screen.getByLabelText(/registered email/i), { target: { value: 'z@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email my character name/i }));
    mockSessions[0].events.emit('charLogin.result', { success: false, message: 'Sent!' });
    const notice = await waitFor(() => screen.getByRole('status'));
    expect(notice.textContent).toBe('Sent!');

    fireEvent.click(screen.getByRole('button', { name: /back to log in/i }));
    fireEvent.click(screen.getByRole('button', { name: /forgot your character name\?/i }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText(/registered email/i)).toBeTruthy();
  });
});
