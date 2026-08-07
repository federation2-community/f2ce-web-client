import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MudSession, setSessionCredentials, type LandingProps } from '@mudlet/mudlet-web';
import { readEnv } from './env';

const LAST_CHARACTER_KEY = 'f2ce:lastCharacter';

// How long to wait for a `charLogin.result` before giving up on a forgot
// request and showing a generic "couldn't reach the server" notice.
const FORGOT_TIMEOUT_MS = 8000;
const FORGOT_TIMEOUT_MESSAGE = "We couldn't reach the server just now. Please try again in a moment.";

// Same timeout used for the headless Char.Create round trip (and its
// throwaway CheckName probes) — see `submitCreate`/`checkNameAvailability`.
const CREATE_TIMEOUT_MS = 8000;
const CREATE_TIMEOUT_MESSAGE = "We couldn't reach the server just now. Please try again in a moment.";

// How long to let the name field sit idle before firing a live
// Char.Create.CheckName probe. A blur fires the check immediately regardless.
const NAME_CHECK_DEBOUNCE_MS = 500;

function readLastCharacter(): string {
  try {
    return localStorage.getItem(LAST_CHARACTER_KEY) ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Char.Create client-side validation.
//
// The engine has no `Char.Create.Rules` GMCP message, so these constants are
// hardcoded copies of the authoritative server-side checks. DRIFT GUARD: if
// the engine's rules ever change, these need to change with them. Source:
// fed2-community branch `gmcp-char-create` @ 0c9cccb5 —
//   - name:     src/login.cc  `Login::ValidateNewAccountName`   (3-15 letters, no spaces/digits)
//   - password: src/login.cc  `Login::ValidateNewAccountPassword` (>= 8 chars, no charset rule)
//   - race:     src/newbie.cc `Newbie::ValidateRace`            (3-15 alphanumeric; free text, no whitelist)
//   - gender:   src/newbie.cc `Newbie::ApplyGender`              (never rejects; offered here as a fixed choice)
//   - stats:    src/newbie.cc `Newbie::ApplyStrength`/`ApplyStamina`/`ApplyDexterity`
//               (140-point budget, order-dependent clamps, intelligence derived — never rejects,
//               so the FE must enforce this itself or the server will silently reinterpret it)
// ---------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z]{3,15}$/;
const RACE_RE = /^[A-Za-z0-9]{3,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;

const STAT_BUDGET = 140;
const STAT_MIN = 20;
const STAT_MAX = 70;

type Gender = 'male' | 'female' | 'neuter';

interface CreateFields {
  name: string;
  password: string;
  confirmPassword: string;
  email: string;
  race: string;
  gender: Gender;
  strength: string;
  stamina: string;
  dexterity: string;
}

type CreateFieldName = 'name' | 'password' | 'confirmPassword' | 'email' | 'race' | 'stats';
type CreateFieldErrors = Partial<Record<CreateFieldName, string>>;

// Newbie::ApplyStamina: remainder = 140 - strength; clamp to [20, min(70, remainder - 40)].
function maxStamina(strength: number): number {
  return Math.min(STAT_MAX, STAT_BUDGET - strength - 40);
}

// Newbie::ApplyDexterity: remainder = 140 - strength - stamina; clamp to [20, min(70, remainder - 20)].
function maxDexterity(strength: number, stamina: number): number {
  return Math.min(STAT_MAX, STAT_BUDGET - strength - stamina - 20);
}

// Newbie::ApplyDexterity's tail: intelligence = min(70, remainder after dex). Derived, not user-settable.
function derivedIntelligence(strength: number, stamina: number, dexterity: number): number {
  return Math.min(STAT_MAX, STAT_BUDGET - strength - stamina - dexterity);
}

function parseStat(value: string): number | null {
  if (!/^-?\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/**
 * Validate every Char.Create field against the hardcoded engine-mirror rules
 * above, plus a stale-aware read of the live name-availability check. Enforcing
 * all of this client-side means a well-formed submit can only fail server-side
 * on a name taken in the race window between the last CheckName and submit.
 */
function validateCreateFields(
  fields: CreateFields,
  nameTaken: boolean,
): CreateFieldErrors {
  const errors: CreateFieldErrors = {};

  if (!NAME_RE.test(fields.name)) {
    errors.name = 'Character name must be 3 to 15 letters, no spaces or digits.';
  } else if (nameTaken) {
    errors.name = 'That character name is already taken.';
  }

  if (fields.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = 'Password must be at least 8 characters.';
  } else if (fields.confirmPassword !== fields.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  // Email is the one optional field (the engine accepts "skip" at creation —
  // see submitCreate's payload build). Only validate format when non-blank.
  if (fields.email.length > 0 && !EMAIL_RE.test(fields.email)) {
    errors.email = 'Enter a valid email address, or leave this field blank.';
  }

  if (!RACE_RE.test(fields.race)) {
    errors.race = 'Race must be 3 to 15 letters or numbers.';
  }

  const strength = parseStat(fields.strength);
  const stamina = parseStat(fields.stamina);
  const dexterity = parseStat(fields.dexterity);
  if (strength === null || stamina === null || dexterity === null) {
    errors.stats = 'Enter whole numbers for strength, stamina and dexterity.';
  } else if (strength < STAT_MIN || strength > STAT_MAX) {
    errors.stats = `Strength must be between ${STAT_MIN} and ${STAT_MAX}.`;
  } else {
    const maxSta = maxStamina(strength);
    if (stamina < STAT_MIN || stamina > maxSta) {
      errors.stats = `Stamina must be between ${STAT_MIN} and ${maxSta}, given that strength.`;
    } else {
      const maxDex = maxDexterity(strength, stamina);
      if (dexterity < STAT_MIN || dexterity > maxDex) {
        errors.stats = `Dexterity must be between ${STAT_MIN} and ${maxDex}, given that strength and stamina.`;
      }
    }
  }

  return errors;
}

type NameCheckStatus = 'checking' | 'available' | 'taken' | 'invalid';
interface NameCheckState {
  name: string;
  status: NameCheckStatus;
}

/**
 * Custom landing for the Federation 2 branded build.
 *
 * Returning-player login and the two forgot flows are driven over GMCP
 * `Char.Login` (see fed2d GmcpLogin) — unchanged by this file's Char.Create
 * work:
 *  - Returning player: `{account: <char name>, password: <password>}`.
 *  - Forgot password:  `{account: "forgot password <char name>", password: <email>}`
 *    → emails a temporary password if the name+email match.
 *  - Forgot username:  `{account: "forgot name", password: <email>}`
 *    → emails the character name(s) registered to that address.
 *
 * "Create a new character" instead drives the engine's one-shot GMCP
 * `Char.Create` path (see fed2d GmcpCreate): a throwaway headless
 * `MudSession` sends `Char.Create` and waits for `Char.Create.Result`. On
 * success we disconnect that headless session and hand off to the exact same
 * `connect()` helper used for returning-player login (now logging into the
 * character that just got created); on failure the form stays up with the
 * server's field error. A second headless session drives live
 * `Char.Create.CheckName` availability checks as the player types/blurs the
 * name field.
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
 *
 * BUGFIX NOTE (live-browser testing found "Create character" did nothing):
 * the submit `<button>` used to carry `disabled={!canSubmitCreate}`, gated on
 * the same client-side validation used for inline messages. A disabled button
 * fires no `onSubmit`, so a player looking at a form that *looked* fillable —
 * most commonly because email was (wrongly) required, or a stat/password
 * rule wasn't yet satisfied — got zero feedback: no error text, no request,
 * nothing. The fix is to never disable the button on validity (only while a
 * submit is in flight); `submitCreateForm` now always runs, sets
 * `submitAttempted`, and either shows the inline errors or proceeds. Email is
 * also now genuinely optional (the engine only treats the literal string
 * `"skip"` as no-email, so a blank field is translated to that on the wire —
 * see `submitCreate`), which was the other half of "a filled-looking form
 * couldn't submit."
 */
export function Landing({ openProfile, ensureBrandProfile }: LandingProps) {
  type Mode = 'login' | 'forgotPassword' | 'forgotName' | 'create';
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState(readLastCharacter);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  // Forgot-form UI state, shared across the two forgot modes (only one is
  // ever visible at a time). Reset whenever the mode changes.
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);

  // Char.Create form state.
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createConfirmPassword, setCreateConfirmPassword] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createRace, setCreateRace] = useState('');
  const [createGender, setCreateGender] = useState<Gender>('female');
  const [createStrength, setCreateStrength] = useState('35');
  const [createStamina, setCreateStamina] = useState('35');
  const [createDexterity, setCreateDexterity] = useState('35');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  // Server-origin field errors from a failed Char.Create.Result (name/password/
  // email/race only — see the field-error mapping in gmcp_create.cc). Cleared
  // as soon as the corresponding field is edited again.
  const [serverErrors, setServerErrors] = useState<CreateFieldErrors>({});
  // Whether the player has attempted a submit yet — gates when client-side
  // validation messages start showing (so the form isn't red before they've
  // typed anything).
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [nameCheck, setNameCheck] = useState<NameCheckState | null>(null);
  const createNameRef = useRef(createName);
  createNameRef.current = createName;
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Drive a throwaway headless MudSession that sends Char.Create.CheckName for
  // `candidate` and applies the reply to `nameCheck` — but only if `candidate`
  // still matches the name field's current value (discards stale replies from
  // an earlier keystroke).
  const checkNameAvailability = (candidate: string) => {
    const session = new MudSession();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      offNegotiated();
      offResult();
      session.disconnect();
      session.destroy();
    };

    const offNegotiated = session.events.on('gmcp.negotiated', () => {
      session.sendGmcpRaw('Char.Create.CheckName ' + JSON.stringify({ name: candidate }));
    });
    const offResult = session.events.on('gmcp', ({ path, value }) => {
      if (path !== 'Char.Create.CheckName.Result') return;
      const result = value as { name: string; available: boolean; reason: 'ok' | 'taken' | 'invalid' };
      finish();
      if (result.name !== createNameRef.current) return; // stale reply — the field has moved on
      setNameCheck({
        name: result.name,
        status: result.available ? 'available' : result.reason === 'taken' ? 'taken' : 'invalid',
      });
    });

    try {
      session.connect(readEnv().VITE_WS_URL);
    } catch {
      finish();
    }
  };

  // Debounced live CheckName as the name field settles (a blur fires
  // immediately — see the input's onBlur below).
  useEffect(() => {
    if (mode !== 'create') return undefined;
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
    if (!NAME_RE.test(createName)) {
      setNameCheck(null);
      return undefined;
    }
    nameCheckTimer.current = setTimeout(() => {
      setNameCheck({ name: createName, status: 'checking' });
      checkNameAvailability(createName);
    }, NAME_CHECK_DEBOUNCE_MS);
    return () => {
      if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createName, mode]);

  const checkNameNow = () => {
    if (!NAME_RE.test(createName)) return;
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
    setNameCheck({ name: createName, status: 'checking' });
    checkNameAvailability(createName);
  };

  // Drive a throwaway headless MudSession for character creation (mirrors
  // `sendForgotRequest`): send Char.Create once GMCP is up, wait for
  // Char.Create.Result. On success, hand off to the same `connect()` login
  // helper used for a returning player (now logging into the character that
  // just got created) — the engine has already created it, this is just an
  // ordinary Char.Login into it. On failure, surface the field error and stay
  // on the form.
  const submitCreate = (fields: CreateFields) => {
    setCreateSubmitting(true);

    const session = new MudSession();
    let settled = false;

    const finish = (after: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      offNegotiated();
      offResult();
      setCreateSubmitting(false);
      after();
      session.disconnect();
      session.destroy();
    };

    const timeoutId = setTimeout(() => {
      finish(() => setServerErrors((prev) => ({ ...prev, name: CREATE_TIMEOUT_MESSAGE })));
    }, CREATE_TIMEOUT_MS);

    const offNegotiated = session.events.on('gmcp.negotiated', () => {
      session.sendGmcpRaw(
        'Char.Create ' +
          JSON.stringify({
            account: fields.name,
            password: fields.password,
            // The engine (Login::ValidateAndCreateAccount) only treats the
            // literal string "skip" as "no email" — an empty string fails its
            // format check and comes back as a field error. Email is optional
            // client-side (see validateCreateFields), so translate a blank
            // field to "skip" here rather than relaxing the server rule.
            email: fields.email.length > 0 ? fields.email : 'skip',
            race: fields.race,
            gender: fields.gender,
            strength: fields.strength,
            stamina: fields.stamina,
            dexterity: fields.dexterity,
          }),
      );
    });
    const offResult = session.events.on('gmcp', ({ path, value }) => {
      if (path !== 'Char.Create.Result') return;
      const result = value as { success: boolean; field?: string; message?: string };
      finish(() => {
        if (result.success) {
          try {
            localStorage.setItem(LAST_CHARACTER_KEY, fields.name);
          } catch {
            /* storage disabled (e.g. private mode) — the prefill just won't persist */
          }
          connect(fields.name, fields.password, fields.name);
        } else {
          const field = (result.field as CreateFieldName) ?? 'name';
          setServerErrors((prev) => ({
            ...prev,
            [field]: result.message ?? CREATE_TIMEOUT_MESSAGE,
          }));
        }
      });
    });

    try {
      session.connect(readEnv().VITE_WS_URL);
    } catch {
      finish(() => setServerErrors((prev) => ({ ...prev, name: CREATE_TIMEOUT_MESSAGE })));
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

  const openCreateForm = () => {
    setServerErrors({});
    setSubmitAttempted(false);
    setNameCheck(null);
    switchMode('create');
  };

  const currentCreateFields = (): CreateFields => ({
    name: createName.trim(),
    password: createPassword,
    confirmPassword: createConfirmPassword,
    email: createEmail.trim(),
    race: createRace.trim(),
    gender: createGender,
    strength: createStrength,
    stamina: createStamina,
    dexterity: createDexterity,
  });

  const liveCreateFields = currentCreateFields();
  const nameTaken = nameCheck?.name === liveCreateFields.name && nameCheck.status === 'taken';
  const liveCreateErrors = validateCreateFields(liveCreateFields, nameTaken);
  // Client-side validation messages only show once a submit has been
  // attempted (so the form isn't red before the player's typed anything);
  // a server-origin field error (e.g. a race-condition dup name) always wins.
  const displayCreateErrors: CreateFieldErrors = {
    ...(submitAttempted ? liveCreateErrors : {}),
    ...serverErrors,
  };

  const submitCreateForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitAttempted(true);
    const fields = currentCreateFields();
    const errors = validateCreateFields(fields, nameTaken);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setServerErrors({});
    submitCreate(fields);
  };

  // Editing a field invalidates any stale server-origin error for it.
  const clearServerError = (field: CreateFieldName) => {
    setServerErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const forgotPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendForgotRequest(`forgot password ${name.trim()}`, email.trim());
  };

  const forgotName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendForgotRequest('forgot name', email.trim());
  };

  const parsedStrength = parseStat(liveCreateFields.strength);
  const parsedStamina = parseStat(liveCreateFields.stamina);
  const parsedDexterity = parseStat(liveCreateFields.dexterity);
  const intelligencePreview =
    parsedStrength !== null && parsedStamina !== null && parsedDexterity !== null
      ? derivedIntelligence(parsedStrength, parsedStamina, parsedDexterity)
      : null;
  const pointsUsed =
    (parsedStrength ?? 0) + (parsedStamina ?? 0) + (parsedDexterity ?? 0) + (intelligencePreview ?? 0);

  return (
    <div className="f2ce-landing">
      <img
        className="f2ce-logo"
        src="https://federation2.com/assets/img/logo.png"
        alt="Federation 2 — Community Edition"
      />

      <div className="f2ce-cards">
        {mode !== 'create' && (
          <section className="f2ce-landing-new">
            <h2>New to Federation&nbsp;2?</h2>
            <p>Start a brand-new character — pick a name, password and stats to get going.</p>
            <button type="button" onClick={openCreateForm}>
              Create a new character
            </button>
          </section>
        )}

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

        {mode === 'create' && (
          // noValidate: hand every field's validation to validateCreateFields
          // so our inline messages are the single source of truth. Without
          // this, the browser's native constraint validation (e.g.
          // type="email" with a non-empty malformed value) silently
          // swallows the submit event before onSubmit ever runs — no
          // request, no error, nothing — which reproduces as exactly the
          // "Create character does nothing" bug (issue #7) whenever the
          // native validation bubble can't be seen (e.g. while the layout
          // was clipped — issue #1).
          <form className="f2ce-landing-create" onSubmit={submitCreateForm} noValidate>
            <h2>Create a new character</h2>

            {/* Two fields per row (name/race, password/confirm, email/gender) —
                the wider two-column card (see .f2ce-landing-create in
                landing.css) is what lets every field + the submit button fit
                on screen without vertical cutoff. */}
            <div className="f2ce-create-grid">
              <div>
                <label htmlFor="f2ce-create-name">Character name</label>
                <input
                  id="f2ce-create-name"
                  type="text"
                  value={createName}
                  onChange={(event) => {
                    setCreateName(event.target.value);
                    clearServerError('name');
                  }}
                  onBlur={checkNameNow}
                  autoComplete="off"
                  aria-invalid={!!displayCreateErrors.name}
                />
                {nameCheck?.name === liveCreateFields.name && (
                  <p className={`f2ce-namecheck f2ce-namecheck-${nameCheck.status}`} role="status">
                    {nameCheck.status === 'checking' && 'Checking availability…'}
                    {nameCheck.status === 'available' && '✓ Available'}
                    {nameCheck.status === 'taken' && '✗ That name is already taken'}
                    {nameCheck.status === 'invalid' && '✗ Not a valid character name'}
                  </p>
                )}
                {displayCreateErrors.name && <p className="f2ce-field-error">{displayCreateErrors.name}</p>}
              </div>

              <div>
                <label htmlFor="f2ce-create-race">Race</label>
                <input
                  id="f2ce-create-race"
                  type="text"
                  value={createRace}
                  onChange={(event) => {
                    setCreateRace(event.target.value);
                    clearServerError('race');
                  }}
                  placeholder="human, vulcan, droid, grue, or anything you invent"
                  autoComplete="off"
                  aria-invalid={!!displayCreateErrors.race}
                />
                {displayCreateErrors.race && <p className="f2ce-field-error">{displayCreateErrors.race}</p>}
              </div>

              <div>
                <label htmlFor="f2ce-create-password">Password</label>
                <input
                  id="f2ce-create-password"
                  type="password"
                  value={createPassword}
                  onChange={(event) => {
                    setCreatePassword(event.target.value);
                    clearServerError('password');
                  }}
                  autoComplete="new-password"
                  aria-invalid={!!displayCreateErrors.password}
                />
                {displayCreateErrors.password && (
                  <p className="f2ce-field-error">{displayCreateErrors.password}</p>
                )}
              </div>

              <div>
                <label htmlFor="f2ce-create-confirm-password">Confirm password</label>
                <input
                  id="f2ce-create-confirm-password"
                  type="password"
                  value={createConfirmPassword}
                  onChange={(event) => setCreateConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  aria-invalid={!!displayCreateErrors.confirmPassword}
                />
                {displayCreateErrors.confirmPassword && (
                  <p className="f2ce-field-error">{displayCreateErrors.confirmPassword}</p>
                )}
              </div>

              <div>
                <label htmlFor="f2ce-create-email">Email</label>
                <input
                  id="f2ce-create-email"
                  type="email"
                  value={createEmail}
                  onChange={(event) => {
                    setCreateEmail(event.target.value);
                    clearServerError('email');
                  }}
                  autoComplete="email"
                  aria-invalid={!!displayCreateErrors.email}
                />
                {displayCreateErrors.email && <p className="f2ce-field-error">{displayCreateErrors.email}</p>}
              </div>

              <fieldset className="f2ce-gender">
                <legend>Gender</legend>
                {(['male', 'female', 'neuter'] as const).map((option) => (
                  <label key={option} className="f2ce-gender-option">
                    <input
                      type="radio"
                      name="f2ce-create-gender"
                      value={option}
                      checked={createGender === option}
                      onChange={() => setCreateGender(option)}
                    />
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </label>
                ))}
              </fieldset>
            </div>

            <fieldset className="f2ce-stats">
              <legend>Stats — 140 points to distribute (20-70 each)</legend>
              <div className="f2ce-stat-tiles">
                <div className="f2ce-stat-tile">
                  <label htmlFor="f2ce-create-strength">Strength</label>
                  <input
                    id="f2ce-create-strength"
                    type="number"
                    value={createStrength}
                    onChange={(event) => setCreateStrength(event.target.value)}
                    aria-invalid={!!displayCreateErrors.stats}
                  />
                </div>
                <div className="f2ce-stat-tile">
                  <label htmlFor="f2ce-create-stamina">Stamina</label>
                  <input
                    id="f2ce-create-stamina"
                    type="number"
                    value={createStamina}
                    onChange={(event) => setCreateStamina(event.target.value)}
                    aria-invalid={!!displayCreateErrors.stats}
                  />
                </div>
                <div className="f2ce-stat-tile">
                  <label htmlFor="f2ce-create-dexterity">Dexterity</label>
                  <input
                    id="f2ce-create-dexterity"
                    type="number"
                    value={createDexterity}
                    onChange={(event) => setCreateDexterity(event.target.value)}
                    aria-invalid={!!displayCreateErrors.stats}
                  />
                </div>
                {/* Read-only: intelligence is derived (140 minus the other
                    three), never user-settable — see derivedIntelligence. */}
                <div className="f2ce-stat-tile f2ce-stat-tile-readonly">
                  <label htmlFor="f2ce-create-intelligence">Intelligence</label>
                  <input
                    id="f2ce-create-intelligence"
                    type="text"
                    value={intelligencePreview ?? '—'}
                    readOnly
                    disabled
                    aria-readonly="true"
                  />
                </div>
              </div>
              <p className="f2ce-stat-budget">
                Total: {pointsUsed} / {STAT_BUDGET}
              </p>
              {displayCreateErrors.stats && <p className="f2ce-field-error">{displayCreateErrors.stats}</p>}
            </fieldset>

            {/* Deliberately NOT disabled by client-side validity: a disabled
                button gives a clicking player zero feedback (this was the
                root cause of "Create character does nothing" — see the
                Landing.tsx class doc comment). It's only disabled mid-flight
                to prevent a double submit; an invalid click instead runs
                validation and surfaces inline field errors below. */}
            <button type="submit" disabled={createSubmitting}>
              {createSubmitting ? 'Creating…' : 'Create character'}
            </button>

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
