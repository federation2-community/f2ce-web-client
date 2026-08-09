import { MudSession } from '@mudlet/mudlet-web';

/**
 * Is Federation 2 actually accepting players right now?
 *
 * WHY THIS EXISTS. Logging in hands the credentials to mudlet-web and opens the
 * terminal. If the game happens to be down at that moment the player lands in
 * the game view staring at a raw disconnect/reconnect prompt, which reads like
 * something broke rather than "the nightly restart is still running." The game
 * stops itself and is brought back by cron every morning on prod (and every
 * hour on test), so this is a routine state, not an incident — it deserves a
 * sentence on the login form, not a scary terminal.
 *
 * HOW WE TELL. The proxy (f2ce-proxy `server.mjs`) dials the game over plain
 * TCP as soon as the browser's WebSocket opens, and is unusually informative
 * about what went wrong:
 *
 *   - game not listening   → `tcp.on('error')` → close 1011 "Upstream: connect ECONNREFUSED …"
 *   - proxy at capacity    → close 1013 "Server busy" / "Too many connections"
 *   - proxy restarting     → close 1001 "Server shutting down"
 *   - proxy unreachable    → the socket never opens at all (1006 / error)
 *
 * So the close code alone distinguishes "the game is down" from "we can't reach
 * the infrastructure", which are different sentences to a player. Anything that
 * gets as far as telnet negotiation proves the game itself is alive and talking.
 */

export type GameState =
  /** Connected and negotiating — the game is up and will accept a login. */
  | 'up'
  /** The proxy answered but the game refused the connection (restart window). */
  | 'down'
  /** The proxy is up and the game may be too, but it is at its connection cap. */
  | 'busy'
  /** Couldn't reach the proxy at all — their network, DNS, or our host. */
  | 'unreachable'
  /** Connected but nothing came back before the deadline. Cause unknown. */
  | 'unknown';

export interface GameStatus {
  state: GameState;
  /** Player-facing sentence. Empty for `up`. */
  message: string;
}

/** How long to wait for telnet negotiation before calling it indeterminate. */
export const PROBE_TIMEOUT_MS = 6000;

/**
 * While the game is down the login form re-probes on this interval so the
 * notice clears itself when the restart finishes, instead of making the player
 * guess when to reload.
 */
export const REPROBE_INTERVAL_MS = 20000;

const MESSAGES: Record<GameState, string> = {
  up: '',
  down:
    "Federation 2 isn't accepting connections at the moment — most often that's " +
    'a scheduled restart, which only takes a couple of minutes. Your login will ' +
    'work again as soon as it finishes.',
  busy: 'Federation 2 is at capacity right now. Please try again in a few minutes.',
  unreachable:
    "We can't reach Federation 2 right now. Check your internet connection, or " +
    'try again in a few minutes.',
  unknown: "Federation 2 isn't responding just now. Please try again in a moment.",
};

export function statusMessage(state: GameState): string {
  return MESSAGES[state];
}

function status(state: GameState): GameStatus {
  return { state, message: MESSAGES[state] };
}

/**
 * Map a WebSocket close to a game state. Exported for tests — the close codes
 * are a contract with f2ce-proxy, and this is the part worth pinning down.
 */
export function stateFromClose(code: number, reason: string): GameState {
  // 1011 is the proxy reporting an upstream (game-side) socket error: the game
  // isn't listening, or dropped us mid-handshake.
  if (code === 1011 && reason.startsWith('Upstream:')) return 'down';
  if (code === 1013) return 'busy';
  // 1000/1005 are a clean close with no negotiation — we never heard from the
  // game, so we cannot claim it is up, but nothing said it is down either.
  if (code === 1000 || code === 1005) return 'unknown';
  // 1001 (proxy shutting down), 1006 (abnormal — never opened), everything else.
  return 'unreachable';
}

/**
 * Open a throwaway headless session and report what the game did. Never
 * rejects: every failure path is one of the GameStates.
 *
 * Mirrors the headless-MudSession pattern already used in Landing for the
 * forgot and Char.Create flows — connect, listen, settle once, always
 * disconnect+destroy.
 */
export function probeGame(url: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<GameStatus> {
  return new Promise((resolve) => {
    const session = new MudSession();
    let settled = false;

    const finish = (state: GameState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      offNegotiated();
      offLogin();
      offClose();
      offError();
      resolve(status(state));
      session.disconnect();
      session.destroy();
    };

    const timeoutId = setTimeout(() => finish('unknown'), timeoutMs);

    // Either of these proves the game accepted the connection and is talking:
    // GMCP negotiation completed, or it got as far as asking us to log in.
    const offNegotiated = session.events.on('gmcp.negotiated', () => finish('up'));
    const offLogin = session.events.on('charLogin.request', () => finish('up'));

    const offClose = session.events.on('close', (event) =>
      finish(stateFromClose(event?.code ?? 1006, event?.reason ?? '')),
    );
    const offError = session.events.on('error', () => finish('unreachable'));

    try {
      session.connect(url);
    } catch {
      finish('unreachable');
    }
  });
}
