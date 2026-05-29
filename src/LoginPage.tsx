import { FormEvent, useState } from 'react';
import { setLoggedIn, validateLogin } from './auth';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ok = await validateLogin(username, password);
      if (!ok) {
        setError('Invalid username or password');
        return;
      }
      setLoggedIn();
      onSuccess();
    } catch {
      setError('Sign-in is unavailable. Ensure users.json is deployed (copy from users.example.json).');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page grid-bg">
      <div className="login-card">
        <div className="login-card-header">
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none" aria-hidden className="shrink-0">
            <circle cx="16" cy="16" r="15" stroke="var(--accent-teal)" strokeWidth="1.5"/>
            <path d="M8 20 L14 14 L18 18 L24 10" stroke="var(--accent-teal)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
            <circle cx="24" cy="10" r="2" fill="var(--accent-amber)"/>
          </svg>
          <div>
            <div className="font-display text-xl leading-none">Plant BESS studio</div>
            <div className="text-[10px] text-[color:var(--text-faint)] font-mono uppercase tracking-wider mt-1">
              Sign in to continue
            </div>
          </div>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }}>
          <label className="login-field">
            <span className="login-field-label">Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              required
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="login-field">
            <span className="login-field-label">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="btn-primary login-submit">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
