import { useState, type FormEvent } from 'react';
import { MudSession, setSessionCredentials, type LandingProps } from '@mudlet/mudlet-web';
import { readEnv } from './env';

const LAST_CHARACTER_KEY = 'f2ce:lastCharacter';

// How long to wait for a `charLogin.result` before giving up on a forgot
// request and showing a generic "couldn't reach the server" notice.
const FORGOT_TIMEOUT_MS = 8000;
const FORGOT_TIMEOUT_MESSAGE = "We couldn't reach the server just now. Please try again in a moment.";

function readLastCharacter(): string {
  try {
    return localStorage.getItem(LAST_CHARACTER_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Custom landing for the Federation 2 branded build.
 *
 * All four login-prompt actions are triggered over GMCP `Char.Login`. The
 * mapping (see fed2d GmcpLogin):
 *  - Returning player: `{account: <char name>, password: <password>}`.
 *  - New character:    `{account: "new", password: ""}` → drives fed2d's
 *    interactive account-creation flow in the terminal.
 *  - Forgot password:  `{account: "forgot password <char name>", password: <email>}`
 *    → emails a temporary password if the name+email match.
 *  - Forgot username:  `{account: "forgot name", password: <email>}`
 *    → emails the character name(s) registered to that address.
 *
 * Login and "Create a new character" stage session credentials via
 * `setSessionCredentials` + `openProfile`, handing off to mudlet-web's
 * terminal — the right behavior when we actually want to end up logged in.
 *
 * The two forgot actions are different: the engine replies
 * `Char.Login.Result{success:false, message}` (a deliberately friendly
 * non-error), but `openProfile`'s `ProfileSession` hardcodes every
 * `success:false` result as a red login error in its own modal. So the
 * forgot actions instead drive a headless `MudSession` directly (see
 * `sendForgotRequest` below), never calling `openProfile`, and render the
 * engine's message as a neutral, Landing-local confirmation.
 *
 * The last character name logged in with is remembered (localStorage) and
 * prefilled.
 */
export function Landing({ openProfile, ensureBrandProfile }: LandingProps) {
  type Mode = 'login' | 'forgotPassword' | 'forgotName';
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState(readLastCharacter);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  // Forgot-form UI state, shared across the two forgot modes (only one is
  // ever visible at a time). Reset whenever the mode changes.
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setForgotSending(false);
    setForgotNotice(null);
  };

  // Stage GMCP Char.Login credentials on a fresh brand profile and connect.
  const connect = (account: string, secret: string, character?: string) => {
    // Omit the arg entirely when there's no character (new/forgot) so a generic
    // brand profile is created rather than one keyed on `undefined`.
    const id = character === undefined ? ensureBrandProfile() : ensureBrandProfile(character);
    setSessionCredentials(id, { account, password: secret });
    openProfile(id, true);
  };

  // Drive a headless MudSession for the forgot flows only — see the class
  // doc comment for why this bypasses `openProfile`. Connects, answers the
  // engine's GMCP Char.Login credentials request with the forgot payload,
  // then renders whatever `charLogin.result` comes back (or a generic
  // fallback on timeout/connect failure) as a Landing-local notice.
  const sendForgotRequest = (account: string, secret: string) => {
    setForgotNotice(null);
    setForgotSending(true);

    const session = new MudSession();
    let settled = false;

    const finish = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      offRequest();
      offResult();
      setForgotSending(false);
      setForgotNotice(message);
      session.disconnect();
      session.destroy();
    };

    const timeoutId = setTimeout(() => finish(FORGOT_TIMEOUT_MESSAGE), FORGOT_TIMEOUT_MS);

    const offRequest = session.events.on('charLogin.request', () => {
      session.sendCharLoginCredentials(account, secret);
    });
    const offResult = session.events.on('charLogin.result', (result) => {
      finish(result.message ?? FORGOT_TIMEOUT_MESSAGE);
    });

    try {
      session.connect(readEnv().VITE_WS_URL);
    } catch {
      finish(FORGOT_TIMEOUT_MESSAGE);
    }
  };

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const character = name.trim();
    try {
      localStorage.setItem(LAST_CHARACTER_KEY, character);
    } catch {
      /* storage disabled (e.g. private mode) — the prefill just won't persist */
    }
    connect(character, password, character);
  };

  const createCharacter = () => {
    // account "new" starts fed2d's interactive creation flow; no password staged.
    connect('new', '');
  };

  const forgotPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendForgotRequest(`forgot password ${name.trim()}`, email.trim());
  };

  const forgotName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendForgotRequest('forgot name', email.trim());
  };

  return (
    <div className="f2ce-landing">
      <img
        className="f2ce-logo"
        src="https://federation2.com/assets/img/logo.png"
        alt="Federation 2 — Community Edition"
      />

      <div className="f2ce-cards">
        <section className="f2ce-landing-new">
          <h2>New to Federation&nbsp;2?</h2>
          <p>Start a brand-new character — we'll take you straight into creating one.</p>
          <button type="button" onClick={createCharacter}>
            Create a new character
          </button>
        </section>

        {mode === 'login' && (
          <form className="f2ce-landing-login" onSubmit={login}>
            <h2>Returning player</h2>
            <div>
              <label htmlFor="f2ce-landing-name">Character name</label>
              <input
                id="f2ce-landing-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label htmlFor="f2ce-landing-password">Password</label>
              <input
                id="f2ce-landing-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button type="submit">Log in</button>
            <div className="f2ce-forgot-links">
              <button type="button" className="f2ce-linkbtn" onClick={() => switchMode('forgotPassword')}>
                Forgot password?
              </button>
              <button type="button" className="f2ce-linkbtn" onClick={() => switchMode('forgotName')}>
                Forgot your character name?
              </button>
            </div>
          </form>
        )}

        {mode === 'forgotPassword' && (
          <form className="f2ce-landing-login" onSubmit={forgotPassword}>
            <h2>Reset your password</h2>
            {forgotNotice ? (
              <p className="f2ce-forgot-notice" role="status">
                {forgotNotice}
              </p>
            ) : (
              <>
                <p>We'll email a temporary password if your character name and registered email match.</p>
                <div>
                  <label htmlFor="f2ce-forgot-pw-name">Character name</label>
                  <input
                    id="f2ce-forgot-pw-name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label htmlFor="f2ce-forgot-pw-email">Registered email</label>
                  <input
                    id="f2ce-forgot-pw-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />
                </div>
                <button type="submit" disabled={forgotSending}>
                  {forgotSending ? 'Sending…' : 'Email me a temporary password'}
                </button>
              </>
            )}
            <div className="f2ce-forgot-links">
              <button type="button" className="f2ce-linkbtn" onClick={() => switchMode('login')}>
                ← Back to log in
              </button>
            </div>
          </form>
        )}

        {mode === 'forgotName' && (
          <form className="f2ce-landing-login" onSubmit={forgotName}>
            <h2>Recover your character name</h2>
            {forgotNotice ? (
              <p className="f2ce-forgot-notice" role="status">
                {forgotNotice}
              </p>
            ) : (
              <>
                <p>We'll email the character name(s) registered to your address.</p>
                <div>
                  <label htmlFor="f2ce-forgot-name-email">Registered email</label>
                  <input
                    id="f2ce-forgot-name-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />
                </div>
                <button type="submit" disabled={forgotSending}>
                  {forgotSending ? 'Sending…' : 'Email my character name(s)'}
                </button>
              </>
            )}
            <div className="f2ce-forgot-links">
              <button type="button" className="f2ce-linkbtn" onClick={() => switchMode('login')}>
                ← Back to log in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
