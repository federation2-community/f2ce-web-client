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
    sendGmcpRaw = vi.fn();
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

  it('clicking "Create a new character" opens the creation form without connecting', () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /create a new character/i }));

    expect(screen.getByRole('heading', { name: /create a new character/i })).toBeTruthy();
    expect(p.ensureBrandProfile).not.toHaveBeenCalled();
    expect(p.openProfile).not.toHaveBeenCalled();
    expect(mockSessions).toHaveLength(0);
  });

  describe('Char.Create form', () => {
    // Fill every field with values that pass client-side validation (default
    // stats 35/35/35 are already a valid equal split of the 140-point budget).
    const fillValidCreateForm = () => {
      fireEvent.change(screen.getByLabelText(/^character name$/i), { target: { value: 'Zaphod' } });
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'longenough1' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'longenough1' } });
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'zaphod@example.com' } });
      fireEvent.change(screen.getByLabelText(/^race$/i), { target: { value: 'human' } });
    };

    const openCreateForm = (p: LandingProps) => {
      render(<Landing {...p} />);
      fireEvent.click(screen.getByRole('button', { name: /create a new character/i }));
    };

    // Regression coverage for issue #7 ("Create character does nothing"):
    // the submit button used to be disabled by client-side validity, which
    // meant an invalid click fired no onSubmit at all — no error, no request,
    // no feedback. It must now always be clickable (live-browser
    // verification of this exact scenario is in e2e/create-smoke.spec.ts).
    it('never disables the submit button on validity — an invalid submit shows inline errors instead of doing nothing', () => {
      const p = props();
      openCreateForm(p);

      const submit = screen.getByRole('button', { name: /^create character$/i }) as HTMLButtonElement;
      expect(submit.disabled).toBe(false);

      // Blank form: clicking must show errors, not silently no-op.
      fireEvent.click(submit);
      expect(screen.getByText(/character name must be 3 to 15 letters/i)).toBeTruthy();
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeTruthy();
      expect(mockSessions).toHaveLength(0);
      expect(submit.disabled).toBe(false);

      fillValidCreateForm();
      // An out-of-budget stamina (given strength 35, max is 65) is still
      // blocked on submit, but the button stays clickable and reachable.
      fireEvent.change(screen.getByLabelText(/^stamina$/i), { target: { value: '999' } });
      expect(submit.disabled).toBe(false);
      fireEvent.click(submit);
      expect(screen.getByText(/stamina must be between/i)).toBeTruthy();
      expect(mockSessions).toHaveLength(0);
    });

    it('email is optional: a blank email passes validation and is sent as "skip" (the engine no-email sentinel)', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      expect(screen.queryByText(/enter a valid email/i)).toBeNull();
      expect(mockSessions).toHaveLength(1);
      act(() => {
        mockSessions[0].events.emit('gmcp.negotiated');
      });
      const sent = JSON.parse(
        (mockSessions[0].sendGmcpRaw as ReturnType<typeof vi.fn>).mock.calls[0][0].replace('Char.Create ', ''),
      );
      expect(sent.email).toBe('skip');
    });

    it('rejects a malformed (non-blank) email', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'not-an-email' } });

      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      expect(screen.getByText(/enter a valid email/i)).toBeTruthy();
      expect(mockSessions).toHaveLength(0);
    });

    it('shows intelligence as a read-only, derived 4th stat tile', () => {
      const p = props();
      openCreateForm(p);

      const intelligence = screen.getByLabelText(/^intelligence$/i) as HTMLInputElement;
      expect(intelligence.readOnly).toBe(true);
      expect(intelligence.disabled).toBe(true);
      // Default strength/stamina/dexterity are 35/35/35 -> derived = 140-105 = 35.
      expect(intelligence.value).toBe('35');

      fireEvent.change(screen.getByLabelText(/^strength$/i), { target: { value: '50' } });
      expect(intelligence.value).toBe('20');
    });

    it('does not show the removed explanatory stat-points paragraph under the title', () => {
      const p = props();
      openCreateForm(p);
      expect(screen.queryByText(/stat points to distribute — strength, stamina and dexterity/i)).toBeNull();
    });

    it('sends the Char.Create GMCP payload on submit', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();

      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      expect(mockSessions).toHaveLength(1);
      const session = mockSessions[0];
      expect(session.connect).toHaveBeenCalledWith('wss://ws-test.federation2.com/');

      act(() => {
        session.events.emit('gmcp.negotiated');
      });
      expect(session.sendGmcpRaw).toHaveBeenCalledWith(
        'Char.Create ' +
          JSON.stringify({
            account: 'Zaphod',
            password: 'longenough1',
            email: 'zaphod@example.com',
            race: 'human',
            gender: 'female',
            strength: '35',
            stamina: '35',
            dexterity: '35',
          }),
      );
    });

    it('on success:true, disconnects the headless session and hands off to the login helper', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();
      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      const session = mockSessions[0];
      act(() => {
        session.events.emit('gmcp.negotiated');
        session.events.emit('gmcp', { path: 'Char.Create.Result', value: { success: true } });
      });

      expect(session.disconnect).toHaveBeenCalled();
      expect(session.destroy).toHaveBeenCalled();
      expect(p.ensureBrandProfile).toHaveBeenCalledWith('Zaphod');
      expect(setSessionCredentials).toHaveBeenCalledWith('conn-1', {
        account: 'Zaphod',
        password: 'longenough1',
      });
      expect(p.openProfile).toHaveBeenCalledWith('conn-1', true);
      expect(localStorage.getItem('f2ce:lastCharacter')).toBe('Zaphod');
    });

    it('on success:false, shows the field error and stays on the form', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();
      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      const session = mockSessions[0];
      act(() => {
        session.events.emit('gmcp.negotiated');
        session.events.emit('gmcp', {
          path: 'Char.Create.Result',
          value: { success: false, field: 'name', message: 'That character name was just taken.' },
        });
      });

      expect(session.disconnect).toHaveBeenCalled();
      expect(p.openProfile).not.toHaveBeenCalled();
      expect(p.ensureBrandProfile).not.toHaveBeenCalled();
      expect(screen.getByText('That character name was just taken.')).toBeTruthy();
      // Still on the create form.
      expect(screen.getByRole('heading', { name: /create a new character/i })).toBeTruthy();
    });

    it('runs a live CheckName on blur and shows availability, ignoring stale replies', () => {
      const p = props();
      openCreateForm(p);

      const nameField = screen.getByLabelText(/^character name$/i);
      fireEvent.change(nameField, { target: { value: 'Trillian' } });
      fireEvent.blur(nameField);

      expect(mockSessions).toHaveLength(1);
      const firstCheck = mockSessions[0];
      act(() => {
        firstCheck.events.emit('gmcp.negotiated');
      });
      expect(firstCheck.sendGmcpRaw).toHaveBeenCalledWith(
        'Char.Create.CheckName ' + JSON.stringify({ name: 'Trillian' }),
      );

      // Before the first reply arrives, the player changes the name and blurs again.
      fireEvent.change(nameField, { target: { value: 'Marvin' } });
      fireEvent.blur(nameField);
      expect(mockSessions).toHaveLength(2);
      const secondCheck = mockSessions[1];
      act(() => {
        secondCheck.events.emit('gmcp.negotiated');
      });
      expect(secondCheck.sendGmcpRaw).toHaveBeenCalledWith(
        'Char.Create.CheckName ' + JSON.stringify({ name: 'Marvin' }),
      );

      // The stale first reply (for "Trillian") is discarded — no availability shown for it.
      act(() => {
        firstCheck.events.emit('gmcp', {
          path: 'Char.Create.CheckName.Result',
          value: { name: 'Trillian', available: false, reason: 'taken' },
        });
      });
      expect(screen.queryByText(/that name is already taken/i)).toBeNull();

      // The current reply (for "Marvin") is applied.
      act(() => {
        secondCheck.events.emit('gmcp', {
          path: 'Char.Create.CheckName.Result',
          value: { name: 'Marvin', available: true, reason: 'ok' },
        });
      });
      expect(screen.getByText(/available/i)).toBeTruthy();
    });
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
