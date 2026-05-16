import { useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase, ensureProfile } from '../lib/supabase.js';
import { GoldButton, Toast } from '../components/SharedUI.jsx';

export default function LoginScreen({ onSignedIn }) {
  const G = useTheme();
  const [mode, setMode]       = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail]     = useState('');
  const [pass,  setPass]      = useState('');
  const [handle, setHandle]   = useState('');
  const [busy,  setBusy]      = useState(false);
  const [toast, setToast]     = useState('');

  const toast2 = (m, ms = 3500) => { setToast(m); setTimeout(() => setToast(''), ms); };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        // If email confirmation is OFF, we are signed in immediately.
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await ensureProfile(handle);
          onSignedIn();
        } else {
          toast2('Check your inbox to confirm, then sign in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        await ensureProfile(handle);
        onSignedIn();
      }
    } catch (e) {
      toast2(e.message || 'Auth failed');
    } finally {
      setBusy(false);
    }
  };

  const input = {
    width: '100%', background: G.surface, border: `1px solid ${G.border}`,
    color: G.text, fontFamily: 'EB Garamond,serif', fontSize: 14,
    padding: '10px 12px', borderRadius: 3, marginBottom: 10, boxSizing: 'border-box',
  };

  return (
    <div style={{
      minHeight: '100dvh', background: G.bg,
      backgroundImage: 'radial-gradient(ellipse at 50% 0%, #1a1208 0%, transparent 60%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '60px 24px', boxSizing: 'border-box',
    }}>
      <div style={{ fontFamily: 'Cinzel Decorative,serif', fontSize: 32, color: G.gold, textShadow: `0 0 40px ${G.gold}66` }}>MAGE</div>
      <div style={{ fontFamily: 'Cinzel,serif', fontSize: 11, letterSpacing: '.5em', color: G.goldDim, marginTop: 2 }}>DM DASHBOARD</div>
      <div style={{ fontFamily: 'EB Garamond,serif', fontStyle: 'italic', fontSize: 13, color: G.muted, marginTop: 10, textAlign: 'center', maxWidth: 320 }}>
        {mode === 'signin' ? 'Sign in to view your chronicle.' : 'Create a Storyteller account.'}
      </div>

      <div style={{ marginTop: 28, width: '100%', maxWidth: 360 }}>
        <input
          style={input} type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          style={input} type="password" placeholder="Password (8+ chars)"
          value={pass} onChange={(e) => setPass(e.target.value)}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />
        <input
          style={input} type="text" placeholder="Display handle (optional)"
          value={handle} onChange={(e) => setHandle(e.target.value)}
        />

        <GoldButton onClick={submit} disabled={busy || !email || !pass} style={{ width: '100%', marginTop: 4 }}>
          {busy ? '…' : (mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT')}
        </GoldButton>

        <button
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          style={{
            marginTop: 14, width: '100%', background: 'transparent', border: 'none',
            color: G.goldDim, fontFamily: 'EB Garamond,serif', fontSize: 13, cursor: 'pointer',
          }}
        >
          {mode === 'signin' ? 'Need an account? Create one →' : 'Have an account? Sign in →'}
        </button>
      </div>

      <Toast msg={toast} />
    </div>
  );
}
