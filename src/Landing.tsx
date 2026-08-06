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
 * fed2d authenticates over TEXT login (name/password typed at telnet prompts);
 * it does not accept inbound GMCP Char.Login. Both actions here drive
 * mudlet-web's text auto-login (session credentials, typed at the prompts):
 *  - Returning player: types the character name + password.
 *  - New character:    types `new` at the Login: prompt (the character-name
 *    slot) to start fed2d's interactive account-creation flow. No password is
 *    staged, so the user completes creation (name/password/persona) themselves.
 *
 * The last character name logged in with is remembered (localStorage) and
 * prefilled.
 */
export function Landing({ openProfile, ensureBrandProfile }: LandingProps) {
  const [name, setName] = useState(readLastCharacter);
  const [password, setPassword] = useState('');

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const character = name.trim();
    try {
      localStorage.setItem(LAST_CHARACTER_KEY, character);
    } catch {
      /* storage disabled (e.g. private mode) — the prefill just won't persist */
    }
    const id = ensureBrandProfile(character);
    setSessionCredentials(id, { account: character, password });
    openProfile(id, true);
  };

  const createCharacter = () => {
    const id = ensureBrandProfile();
    // Auto-answer fed2d's "Login:" prompt with `new` to start account creation.
    // Empty password isn't sent, so the user drives the rest interactively.
    setSessionCredentials(id, { account: 'new', password: '' });
    openProfile(id, true);
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
        </form>
      </div>
    </div>
  );
}
