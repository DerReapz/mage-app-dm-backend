import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Card, ConfirmModal, GoldButton, Header, Label, Toast } from '../components/SharedUI.jsx';

export default function SessionsListScreen({ user, onOpenSession, onSignOut }) {
  const G = useTheme();
  const [sessions,       setSessions]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [creating,       setCreating]       = useState(false);
  const [newName,        setNewName]        = useState('');
  const [toast,          setToast]          = useState('');
  const [confirmDelete,  setConfirmDelete]  = useState(null);

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

  const backupSession = async (s) => {
    toast2('Preparing backup…');
    const { data, error } = await supabase
      .from('characters')
      .select('id, name, sheet, updated_at, profiles:player_id(handle)')
      .eq('session_id', s.id);
    if (error) { toast2(error.message); return; }
    const payload = {
      session: { id: s.id, name: s.name, invite_code: s.invite_code, created_at: s.created_at },
      characters: data,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${s.name.replace(/[^a-z0-9]/gi, '_')}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast2('Backup downloaded');
  };

  const doDelete = async () => {
    const s = confirmDelete;
    setConfirmDelete(null);
    const { error } = await supabase
      .from('game_sessions')
      .delete()
      .eq('id', s.id);
    if (error) { toast2(error.message); return; }
    toast2(`"${s.name}" deleted`);
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
          <Card key={s.id}>
            <div onClick={() => onOpenSession(s)} style={{ cursor: 'pointer' }}>
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
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => backupSession(s)} style={{
                fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.15em',
                border: `1px solid ${G.gold}55`, borderRadius: 3,
                background: 'transparent', color: G.goldDim, padding: '5px 10px', cursor: 'pointer',
              }}>BACKUP</button>
              <button onClick={() => setConfirmDelete(s)} style={{
                fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.15em',
                border: `1px solid ${G.red}88`, borderRadius: 3,
                background: 'transparent', color: G.red, padding: '5px 10px', cursor: 'pointer',
              }}>DELETE</button>
            </div>
          </Card>
        ))}
      </div>

      <ConfirmModal
        message={confirmDelete ? `Delete "${confirmDelete.name}"? This will permanently remove all characters and data for this chronicle.` : null}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast msg={toast} />
    </div>
  );
}
