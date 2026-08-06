import { useState, type FormEvent } from 'react';
import { setSessionCredentials, type LandingProps } from '@mudlet/mudlet-web';

const LAST_CHARACTER_KEY = 'f2ce:lastCharacter';

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
 * All four login-prompt actions are triggered over GMCP `Char.Login`: we stage
 * session credentials `{account, password}` and connect; the engine's inbound
 * Char.Login handler acts on them. The mapping (see fed2d GmcpLogin):
 *  - Returning player: `{account: <char name>, password: <password>}`.
 *  - New character:    `{account: "new", password: ""}` → drives fed2d's
 *    interactive account-creation flow in the terminal.
 *  - Forgot password:  `{account: "forgot password <char name>", password: <email>}`
 *    → emails a temporary password if the name+email match.
 *  - Forgot username:  `{account: "forgot name", password: <email>}`
 *    → emails the character name(s) registered to that address.
 * The forgot actions reply `Char.Login.Result{success:false, message}`, so the
 * client stays on the login screen and shows the confirmation.
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

  // Stage GMCP Char.Login credentials on a fresh brand profile and connect.
  const connect = (account: string, secret: string, character?: string) => {
    // Omit the arg entirely when there's no character (new/forgot) so a generic
    // brand profile is created rather than one keyed on `undefined`.
    const id = character === undefined ? ensureBrandProfile() : ensureBrandProfile(character);
    setSessionCredentials(id, { account, password: secret });
    openProfile(id, true);
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
    connect(`forgot password ${name.trim()}`, email.trim());
  };

  const forgotName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    connect('forgot name', email.trim());
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
              <button type="button" className="f2ce-linkbtn" onClick={() => setMode('forgotPassword')}>
                Forgot password?
              </button>
              <button type="button" className="f2ce-linkbtn" onClick={() => setMode('forgotName')}>
                Forgot your character name?
              </button>
            </div>
          </form>
        )}

        {mode === 'forgotPassword' && (
          <form className="f2ce-landing-login" onSubmit={forgotPassword}>
            <h2>Reset your password</h2>
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
            <button type="submit">Email me a temporary password</button>
            <div className="f2ce-forgot-links">
              <button type="button" className="f2ce-linkbtn" onClick={() => setMode('login')}>
                ← Back to log in
              </button>
            </div>
          </form>
        )}

        {mode === 'forgotName' && (
          <form className="f2ce-landing-login" onSubmit={forgotName}>
            <h2>Recover your character name</h2>
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
            <button type="submit">Email my character name(s)</button>
            <div className="f2ce-forgot-links">
              <button type="button" className="f2ce-linkbtn" onClick={() => setMode('login')}>
                ← Back to log in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
