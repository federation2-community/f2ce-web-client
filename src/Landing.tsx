import { useState, type FormEvent } from 'react';
import { setSessionCredentials, type LandingProps } from '@mudlet/mudlet-web';

/**
 * Custom landing for the Federation 2 branded build. The stock
 * `BrandLoginScreen` only drives fed2d's GMCP/text auto-login with a
 * name+password pair, but new accounts are created through a separate,
 * multi-step *interactive* telnet flow: at the login prompt you type the
 * literal name `new` and fed2d walks you through account name, password,
 * confirmation and persona setup from there. So alongside a quick login for
 * returning players, this screen offers a "Create a new character" action
 * that opens the connection with no credentials staged — `openProfile` dials
 * in, but with `setSessionCredentials(id, null)` there's nothing for the
 * auto-login path to submit, so fed2d's raw prompts drive instead.
 */
export function Landing({ openProfile, ensureBrandProfile }: LandingProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = ensureBrandProfile(name.trim());
    setSessionCredentials(id, { account: name.trim(), password });
    openProfile(id, true);
  };

  const createCharacter = () => {
    const id = ensureBrandProfile();
    // No auto-login — fed2d's raw interactive prompt drives from here.
    setSessionCredentials(id, null);
    openProfile(id, true);
  };

  return (
    <div className="f2ce-landing">
      <img
        className="f2ce-logo"
        src="https://federation2.com/assets/img/logo.png"
        alt="Federation 2 — Community Edition"
      />
      <form onSubmit={login}>
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

      <div className="f2ce-landing-new">
        <button type="button" onClick={createCharacter}>
          Create a new character
        </button>
        <p>At the prompt, type <code>new</code> to create a character.</p>
      </div>
    </div>
  );
}
