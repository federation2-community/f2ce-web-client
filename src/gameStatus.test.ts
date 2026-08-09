// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { probeGame, stateFromClose, statusMessage, PROBE_TIMEOUT_MS } from './gameStatus';

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
  }

  const mockSessions: MockMudSession[] = [];
  return { mockSessions, MockMudSession };
});

vi.mock('@mudlet/mudlet-web', () => ({
  MudSession: vi.fn().mockImplementation(() => {
    const session = new MockMudSession();
    mockSessions.push(session);
    return session;
  }),
}));

beforeEach(() => {
  mockSessions.length = 0;
});

// These codes are a contract with f2ce-proxy's server.mjs. If that file's
// ws.close(...) calls change, these tests are the ones that should fail.
describe('stateFromClose', () => {
  it('reads the proxy\'s upstream error as the game being down', () => {
    expect(stateFromClose(1011, 'Upstream: connect ECONNREFUSED 10.0.0.4:30003')).toBe('down');
    expect(stateFromClose(1011, 'Upstream: read ECONNRESET')).toBe('down');
  });

  it('handles an upstream error with no message at all', () => {
    // Observed on the real stack, and the case production will actually hit.
    // The proxy dials TARGET_HOST by NAME (`host.docker.internal` in prod,
    // `localhost` in dev-stack), so Node tries both IPv6 and IPv4 and reports
    // the pair as an AggregateError — whose `.message` is the empty string. The
    // proxy interpolates that, so the wire carries a bare "Upstream: ".
    //
    // This is why the check keys on the prefix and not on the errno text:
    // matching /ECONNREFUSED/ would pass against a numeric TARGET_HOST and then
    // silently fail in production, leaving players in the terminal.
    expect(stateFromClose(1011, 'Upstream: ')).toBe('down');
  });

  it('does not treat a bare 1011 as the game being down', () => {
    // 1011 without the proxy's own prefix is some other internal error; we
    // must not tell the player "scheduled restart" on a guess.
    expect(stateFromClose(1011, 'something else')).toBe('unreachable');
  });

  it('reads 1013 as the proxy being at capacity', () => {
    expect(stateFromClose(1013, 'Server busy')).toBe('busy');
    expect(stateFromClose(1013, 'Too many connections')).toBe('busy');
  });

  it('reads a proxy shutdown or a socket that never opened as unreachable', () => {
    expect(stateFromClose(1001, 'Server shutting down')).toBe('unreachable');
    expect(stateFromClose(1006, '')).toBe('unreachable');
  });

  it('reads a clean close with nothing said as indeterminate', () => {
    expect(stateFromClose(1000, '')).toBe('unknown');
    expect(stateFromClose(1005, '')).toBe('unknown');
  });
});

describe('statusMessage', () => {
  it('says nothing when the game is up', () => {
    expect(statusMessage('up')).toBe('');
  });

  it('gives every failure state a player-facing sentence', () => {
    for (const state of ['down', 'busy', 'unreachable', 'unknown'] as const) {
      expect(statusMessage(state).length).toBeGreaterThan(0);
    }
  });
});

describe('probeGame', () => {
  it('reports up once telnet negotiation completes', async () => {
    const promise = probeGame('wss://example.test/');
    mockSessions[0].events.emit('gmcp.negotiated');
    await expect(promise).resolves.toEqual({ state: 'up', message: '' });
  });

  it('also accepts the login prompt as proof the game is alive', async () => {
    const promise = probeGame('wss://example.test/');
    mockSessions[0].events.emit('charLogin.request', []);
    expect((await promise).state).toBe('up');
  });

  it('reports down when the proxy says the game refused us', async () => {
    const promise = probeGame('wss://example.test/');
    mockSessions[0].events.emit('close', { code: 1011, reason: 'Upstream: connect ECONNREFUSED' });
    const result = await promise;
    expect(result.state).toBe('down');
    expect(result.message).toMatch(/scheduled restart/i);
  });

  it('always tears the session down, whatever the outcome', async () => {
    const promise = probeGame('wss://example.test/');
    mockSessions[0].events.emit('close', { code: 1006, reason: '' });
    await promise;
    expect(mockSessions[0].disconnect).toHaveBeenCalled();
    expect(mockSessions[0].destroy).toHaveBeenCalled();
  });

  it('settles once, even if the session keeps emitting', async () => {
    const promise = probeGame('wss://example.test/');
    mockSessions[0].events.emit('gmcp.negotiated');
    mockSessions[0].events.emit('close', { code: 1011, reason: 'Upstream: gone' });
    expect((await promise).state).toBe('up');
    expect(mockSessions[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('reports unreachable when connect throws outright', async () => {
    const { MudSession } = await import('@mudlet/mudlet-web');
    vi.mocked(MudSession).mockImplementationOnce(() => {
      const session = new MockMudSession();
      session.connect = vi.fn(() => {
        throw new Error('bad url');
      });
      mockSessions.push(session);
      return session as never;
    });
    expect((await probeGame('not-a-url')).state).toBe('unreachable');
  });

  it('gives up as indeterminate rather than hanging', async () => {
    vi.useFakeTimers();
    try {
      const promise = probeGame('wss://example.test/');
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
      expect((await promise).state).toBe('unknown');
      expect(mockSessions[0].destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
