import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Card, GoldButton, Header, Label, Toast } from '../components/SharedUI.jsx';

export default function SessionsListScreen({ user, onOpenSession, onSignOut }) {
  const G = useTheme();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');
  const [toast,   setToast]     = useState('');

  const toast2 = (m, ms = 3000) => { setToast(m); setTimeout(() => setToast(''), ms); };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('game_sessions')
      .select('id, name, invite_code, created_at')
      .order('created_at', { ascending: false });
    if (error) toast2(error.message);
    setSessions(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const { error } = await supabase
      .from('game_sessions')
      .insert({ name: newName.trim(), dm_id: user.id, invite_code: '' });
    setCreating(false);
    if (error) { toast2(error.message); return; }
    setNewName('');
    load();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    onSignOut();
  };

  return (
    <div style={{ minHeight: '100dvh', background: G.bg, paddingBottom: 40 }}>
      <Header
        title="Chronicles"
        subtitle={user.email}
        right={
          <button onClick={signOut} style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em',
            border: `1px solid ${G.gold}55`, borderRadius: 3,
            background: 'transparent', color: G.goldDim, padding: '6px 10px', cursor: 'pointer',
          }}>SIGN OUT</button>
        }
      />

      <div style={{ padding: '14px 16px 0' }}>
        <Card>
          <Label>New chronicle</Label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. The Ashen Reverie"
              style={{
                flex: 1, background: G.surface, border: `1px solid ${G.border}`,
                color: G.text, fontFamily: 'EB Garamond,serif', fontSize: 14,
                padding: '8px 10px', borderRadius: 3, boxSizing: 'border-box',
              }}
            />
            <GoldButton onClick={create} disabled={creating || !newName.trim()} style={{ fontSize: 10 }}>
              + CREATE
            </GoldButton>
          </div>
        </Card>

        {loading && (
          <div style={{ color: G.muted, fontStyle: 'italic', textAlign: 'center', marginTop: 24 }}>Loading…</div>
        )}
        {!loading && sessions.length === 0 && (
          <div style={{ color: G.goldDim, fontStyle: 'italic', textAlign: 'center', marginTop: 24 }}>
            No chronicles yet. Create one above.
          </div>
        )}

        {sessions.map((s) => (
          <Card key={s.id} style={{ cursor: 'pointer' }}>
            <div onClick={() => onOpenSession(s)}>
              <div style={{ fontFamily: 'Cinzel,serif', fontSize: 15, color: G.gold }}>{s.name}</div>
              <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                <span style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim }}>
                  INVITE&nbsp;CODE&nbsp;{s.invite_code}
                </span>
                <span style={{ fontFamily: 'Cinzel,serif', fontSize: 10, color: `${G.gold}44` }}>
                  {new Date(s.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Toast msg={toast} />
    </div>
  );
}
