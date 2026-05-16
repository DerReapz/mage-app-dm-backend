import { useEffect, useState } from 'react';
import { useTheme } from './context/ThemeContext.jsx';
import { supabase } from './lib/supabase.js';
import LoginScreen          from './screens/LoginScreen.jsx';
import SessionsListScreen   from './screens/SessionsListScreen.jsx';
import SessionDetailScreen  from './screens/SessionDetailScreen.jsx';
import CharacterSheetView   from './screens/CharacterSheetView.jsx';

export default function App() {
  const G = useTheme();
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);  // selected game_session row
  const [char,    setChar]    = useState(null);  // selected character row

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user || null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setUser(s?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{
        height: '100dvh', background: G.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: G.goldDim, fontFamily: 'Cinzel,serif', letterSpacing: '.3em',
      }}>LOADING…</div>
    );
  }

  if (!user) {
    return <LoginScreen onSignedIn={() => supabase.auth.getUser().then(({ data }) => setUser(data.user))} />;
  }

  if (char) {
    return <CharacterSheetView character={char} onBack={() => setChar(null)} />;
  }

  if (session) {
    return (
      <SessionDetailScreen
        session={session}
        onBack={() => setSession(null)}
        onOpenChar={(c) => setChar(c)}
      />
    );
  }

  return (
    <SessionsListScreen
      user={user}
      onOpenSession={(s) => setSession(s)}
      onSignOut={() => setUser(null)}
    />
  );
}
