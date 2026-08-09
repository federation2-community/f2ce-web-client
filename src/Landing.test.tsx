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

// Login pre-flights a liveness probe (gameStatus.probeGame) before handing off
// to the terminal, so a down game never dumps the player into a raw reconnect
// prompt. `gmcp.negotiated` is the "game is up" signal; emitting it lets the
// awaited probe settle and the login continue.
const answerProbeUp = async (index = 0) => {
  await act(async () => {
    mockSessions[index].events.emit('gmcp.negotiated');
  });
};

// The other half: the proxy closes with 1011 + "Upstream: …" when the game
// itself refused the connection (a restart window).
const answerProbeDown = async (index = 0) => {
  await act(async () => {
    mockSessions[index].events.emit('close', {
      code: 1011,
      reason: 'Upstream: connect ECONNREFUSED 127.0.0.1:30003',
    });
  });
};

describe('Landing', () => {
  it('logs in a returning player with the entered name and password', async () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Zaphod' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await answerProbeUp();

    expect(p.ensureBrandProfile).toHaveBeenCalledWith('Zaphod');
    expect(p.openProfile).toHaveBeenCalledWith('conn-1', true);
    expect(setSessionCredentials).toHaveBeenCalledWith('conn-1', { account: 'Zaphod', password: 'secret' });
    // The probe is the only headless session login opens.
    expect(mockSessions).toHaveLength(1);
  });

  it('does not enter the game view when the game is down, and says why', async () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Zaphod' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await answerProbeDown();

    // The whole point: no hand-off to the terminal.
    expect(p.openProfile).not.toHaveBeenCalled();
    expect(setSessionCredentials).not.toHaveBeenCalled();
    expect(screen.getByText(/scheduled restart/i)).toBeTruthy();
    // And the probe cleans up after itself.
    expect(mockSessions[0].disconnect).toHaveBeenCalled();
    expect(mockSessions[0].destroy).toHaveBeenCalled();
  });

  it('distinguishes an unreachable proxy from a down game', async () => {
    const p = props();
    render(<Landing {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /log in/i }));
    await act(async () => {
      // No close frame — the socket never opened.
      mockSessions[0].events.emit('close', { code: 1006, reason: '' });
    });

    expect(p.openProfile).not.toHaveBeenCalled();
    expect(screen.getByText(/check your internet connection/i)).toBeTruthy();
  });

  it('warns that the game is down before the player even types', async () => {
    render(<Landing {...props()} />);

    // The mount probe is scheduled, not synchronous — nothing is claimed until
    // it answers, so the form never flashes a banner while it is finding out.
    expect(screen.queryByText(/scheduled restart/i)).toBeNull();

    await waitFor(() => expect(mockSessions).toHaveLength(1));
    await answerProbeDown();

    expect(screen.getByText(/scheduled restart/i)).toBeTruthy();
  });

  it('says nothing on mount when the game is up', async () => {
    render(<Landing {...props()} />);
    await waitFor(() => expect(mockSessions).toHaveLength(1));
    await answerProbeUp();

    expect(screen.queryByText(/scheduled restart/i)).toBeNull();
    expect(screen.queryByText(/check your internet connection/i)).toBeNull();
  });

  it('remembers the last character name and prefills it', () => {
    localStorage.setItem('f2ce:lastCharacter', 'Trillian');
    render(<Landing {...props()} />);
    expect((screen.getByLabelText(/character name/i) as HTMLInputElement).value).toBe('Trillian');
  });

  it('persists the character name on login', async () => {
    const p = props();
    render(<Landing {...p} />);
    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Ford' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));
    await answerProbeUp();
    expect(localStorage.getItem('f2ce:lastCharacter')).toBe('Ford');
  });

  it('does not remember the character name when the login never happened', async () => {
    const p = props();
    render(<Landing {...p} />);
    fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Ford' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));
    await answerProbeDown();
    expect(localStorage.getItem('f2ce:lastCharacter')).toBeNull();
  });

  // The password is persisted in plaintext, so the guarantees worth pinning
  // down are about when it is NOT written, as much as when it is.
  describe('save my password', () => {
    const saveBox = () => screen.getByLabelText(/save my password/i) as HTMLInputElement;
    const passwordField = () => screen.getByLabelText(/^password$/i) as HTMLInputElement;

    it('is off by default and saves nothing', async () => {
      render(<Landing {...props()} />);
      expect(saveBox().checked).toBe(false);

      fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Ford' } });
      fireEvent.change(passwordField(), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: /log in/i }));
      await answerProbeUp();

      expect(localStorage.getItem('f2ce:savedLogin')).toBeNull();
    });

    it('saves the password only once the login actually goes through', async () => {
      render(<Landing {...props()} />);
      fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Ford' } });
      fireEvent.change(passwordField(), { target: { value: 'secret' } });
      fireEvent.click(saveBox());
      fireEvent.click(screen.getByRole('button', { name: /log in/i }));

      // Still nothing while the probe is in flight.
      expect(localStorage.getItem('f2ce:savedLogin')).toBeNull();

      await answerProbeUp();
      expect(JSON.parse(localStorage.getItem('f2ce:savedLogin')!)).toEqual({
        character: 'Ford',
        password: 'secret',
      });
    });

    it('does not save a password for a login that never happened', async () => {
      render(<Landing {...props()} />);
      fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Ford' } });
      fireEvent.change(passwordField(), { target: { value: 'typo' } });
      fireEvent.click(saveBox());
      fireEvent.click(screen.getByRole('button', { name: /log in/i }));
      await answerProbeDown();

      expect(localStorage.getItem('f2ce:savedLogin')).toBeNull();
    });

    it('prefills a saved password, ticked, for the remembered character', () => {
      localStorage.setItem('f2ce:lastCharacter', 'Ford');
      localStorage.setItem(
        'f2ce:savedLogin',
        JSON.stringify({ character: 'Ford', password: 'secret' }),
      );
      render(<Landing {...props()} />);

      expect(passwordField().value).toBe('secret');
      expect(saveBox().checked).toBe(true);
    });

    it('will not hand one character\'s saved password to another', () => {
      localStorage.setItem('f2ce:lastCharacter', 'Ford');
      localStorage.setItem(
        'f2ce:savedLogin',
        JSON.stringify({ character: 'Ford', password: 'secret' }),
      );
      render(<Landing {...props()} />);
      expect(passwordField().value).toBe('secret');

      fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Zaphod' } });
      expect(passwordField().value).toBe('');

      // ...and typing the original name back restores it.
      fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Ford' } });
      expect(passwordField().value).toBe('secret');
    });

    it('keeps a password the player typed themselves when the name changes', () => {
      localStorage.setItem('f2ce:lastCharacter', 'Ford');
      localStorage.setItem(
        'f2ce:savedLogin',
        JSON.stringify({ character: 'Ford', password: 'secret' }),
      );
      render(<Landing {...props()} />);

      fireEvent.change(passwordField(), { target: { value: 'a-different-one' } });
      fireEvent.change(screen.getByLabelText(/character name/i), { target: { value: 'Zaphod' } });

      // Only the untouched prefill gets cleared — this one they entered.
      expect(passwordField().value).toBe('a-different-one');
    });

    it('erases the stored password the moment it is unticked', () => {
      localStorage.setItem('f2ce:lastCharacter', 'Ford');
      localStorage.setItem(
        'f2ce:savedLogin',
        JSON.stringify({ character: 'Ford', password: 'secret' }),
      );
      render(<Landing {...props()} />);

      fireEvent.click(saveBox());

      // Not deferred to the next login: closing the tab now must leave nothing.
      expect(localStorage.getItem('f2ce:savedLogin')).toBeNull();
    });

    it('states the tradeoff while the box is ticked', () => {
      render(<Landing {...props()} />);
      expect(screen.queryByText(/stored unencrypted/i)).toBeNull();
      fireEvent.click(saveBox());
      expect(screen.getByText(/stored unencrypted/i)).toBeTruthy();
    });

    it('survives corrupt or unreadable storage', () => {
      localStorage.setItem('f2ce:savedLogin', 'not json{');
      render(<Landing {...props()} />);
      expect(passwordField().value).toBe('');
      expect(saveBox().checked).toBe(false);
    });
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

    it('labels the email field optional', () => {
      const p = props();
      openCreateForm(p);
      expect(screen.getByLabelText(/email \(optional\)/i)).toBeTruthy();
    });

    it('email is optional: a blank email opens the no-email confirmation instead of submitting outright', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      // Valid form, but no email — the confirmation is shown and nothing is
      // created yet (not a validation error, either).
      expect(screen.queryByText(/enter a valid email/i)).toBeNull();
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(mockSessions).toHaveLength(0);
    });

    it('no-email confirmation: "Continue without email" creates and sends "skip"', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      fireEvent.click(screen.getByRole('button', { name: /continue without email/i }));

      expect(mockSessions).toHaveLength(1);
      act(() => {
        mockSessions[0].events.emit('gmcp.negotiated');
      });
      const sent = JSON.parse(
        (mockSessions[0].sendGmcpRaw as ReturnType<typeof vi.fn>).mock.calls[0][0].replace('Char.Create ', ''),
      );
      expect(sent.email).toBe('skip');
    });

    it('no-email confirmation: "Provide an email" dismisses and creates nothing', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));
      expect(screen.getByRole('dialog')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /provide an email/i }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mockSessions).toHaveLength(0);
      expect(screen.getByRole('heading', { name: /create a new character/i })).toBeTruthy();
    });

    it('a provided email creates immediately, no confirmation dialog', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm(); // includes zaphod@example.com

      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mockSessions).toHaveLength(1);
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

    it('stops "Checking availability…" when the game is down instead of spinning forever', () => {
      const p = props();
      openCreateForm(p);

      const nameField = screen.getByLabelText(/^character name$/i);
      fireEvent.change(nameField, { target: { value: 'Trillian' } });
      fireEvent.blur(nameField);

      expect(screen.getByText(/checking availability/i)).toBeTruthy();

      // The game is down, so no CheckName.Result will ever come back. Before
      // this had a close handler the field sat on "Checking…" indefinitely.
      act(() => {
        mockSessions[0].events.emit('close', { code: 1011, reason: 'Upstream: connect ECONNREFUSED' });
      });

      expect(screen.queryByText(/checking availability/i)).toBeNull();
      expect(mockSessions[0].destroy).toHaveBeenCalled();
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

    // Regression: a taken name used to surface the message twice — once from
    // the live name-check line and again from the field-level validation error
    // after a submit attempt. Only the live-check line should show.
    it('shows a single "name taken" message, not a duplicate field error', () => {
      const p = props();
      openCreateForm(p);
      fillValidCreateForm();

      // Live CheckName for the current name comes back "taken".
      fireEvent.blur(screen.getByLabelText(/^character name$/i));
      expect(mockSessions).toHaveLength(1);
      act(() => {
        mockSessions[0].events.emit('gmcp.negotiated');
        mockSessions[0].events.emit('gmcp', {
          path: 'Char.Create.CheckName.Result',
          value: { name: 'Zaphod', available: false, reason: 'taken' },
        });
      });

      // A submit attempt would also produce a field-level "taken" error; it
      // must not double up with the live-check line (which stays visible).
      fireEvent.click(screen.getByRole('button', { name: /^create character$/i }));

      const takenMsgs = screen.getAllByText(/already taken/i);
      expect(takenMsgs).toHaveLength(1);
      expect(takenMsgs[0].textContent).toMatch(/that name is already taken/i);
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

      // Queried by text, not by role: advancing the clock this far also fires
      // the mount-time game probe, whose own notice is a second role="status".
      const notice = screen.getByText(/couldn't reach the server just now/i);
      expect(notice.getAttribute('role')).toBe('status');
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
