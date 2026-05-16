import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Card, Header, Toast } from '../components/SharedUI.jsx';

export default function SessionDetailScreen({ session, onBack, onOpenChar }) {
  const G = useTheme();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState('');

  const toast2 = (m, ms = 3000) => { setToast(m); setTimeout(() => setToast(''), ms); };

  const load = async () => {
    setLoading(true);
    // RLS lets the DM see all characters in their sessions.
    const { data, error } = await supabase
      .from('characters')
      .select('id, player_id, name, sheet, updated_at, profiles:player_id(handle)')
      .eq('session_id', session.id)
      .order('updated_at', { ascending: false });
    if (error) toast2(error.message);
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [session.id]);

  // Live updates via Supabase Realtime — push any change for this session into state.
  useEffect(() => {
    const ch = supabase
      .channel(`session-${session.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'characters', filter: `session_id=eq.${session.id}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session.id]);

  return (
    <div style={{ minHeight: '100dvh', background: G.bg, paddingBottom: 40 }}>
      <Header
        title={session.name}
        subtitle={`Invite code: ${session.invite_code}`}
        onBack={onBack}
      />

      <div style={{ padding: '14px 16px 0' }}>
        {loading && <div style={{ color: G.muted, fontStyle: 'italic', textAlign: 'center', marginTop: 24 }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ color: G.goldDim, fontStyle: 'italic', textAlign: 'center', marginTop: 24 }}>
            No characters yet. Share the invite code with your players and have them join from the player app.
          </div>
        )}

        {rows.map((r) => {
          const s     = r.sheet || {};
          const name  = s.identity?.name || r.name || 'Unnamed Mage';
          const trad  = s.identity?.tradition || '—';
          const arete = (s.arete || []).filter(Boolean).length;
          const dmg   = (s.health || []).filter((v) => v > 0).length;
          const max   = (s.health || []).length || 15;
          const ts    = r.updated_at ? new Date(r.updated_at).toLocaleString() : '';
          return (
            <Card key={r.id} style={{ cursor: 'pointer' }}>
              <div onClick={() => onOpenChar(r)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div style={{ fontFamily: 'Cinzel,serif', fontSize: 15, color: G.gold }}>{name}</div>
                  <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.15em', color: G.muted }}>
                    {r.profiles?.handle || ''}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: G.textDim, marginTop: 3 }}>{trad}</div>
                <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.15em', color: G.goldDim }}>
                    ARETE&nbsp;{arete}
                  </span>
                  <span style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.15em', color: dmg > 0 ? G.red : G.goldDim }}>
                    HEALTH&nbsp;{max - dmg}/{max}
                  </span>
                  <span style={{ fontFamily: 'Cinzel,serif', fontSize: 9, color: `${G.gold}44` }}>{ts}</span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Toast msg={toast} />
    </div>
  );
}
