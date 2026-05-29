import { useEffect, useState } from 'react';
import App from './app';
import { clearSession, isLoggedIn, touchActivity } from './auth';
import { LoginPage } from './LoginPage';

const IDLE_CHECK_MS = 30_000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export default function Root() {
  const [authed, setAuthed] = useState(isLoggedIn);

  useEffect(() => {
    if (!authed) return;

    touchActivity();

    const onActivity = () => touchActivity();

    const checkIdle = () => {
      if (!isLoggedIn()) {
        clearSession();
        setAuthed(false);
      }
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', checkIdle);
    const intervalId = window.setInterval(checkIdle, IDLE_CHECK_MS);

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      document.removeEventListener('visibilitychange', checkIdle);
      window.clearInterval(intervalId);
    };
  }, [authed]);

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }

  return (
    <App
      onLogout={() => {
        clearSession();
        setAuthed(false);
      }}
    />
  );
}
