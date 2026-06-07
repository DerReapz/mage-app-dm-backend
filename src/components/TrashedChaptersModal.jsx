import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';

// Lists soft-deleted chapters for a session and lets the DM restore them or
// permanently purge. The DM dashboard is DM-only, so the purge button is
// always shown here.
export default function TrashedChaptersModal({ sessionId, onClose, onMsg }) {
  const G = useTheme();
  const [rows, setRows] = useState(null);
  const [err,  setErr]  = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmPurge, setConfirmPurge] = useState(null);

  const load = async () => {
    setErr('');
    const { data, error } = await supabase
      .from('story_pages')
      .select('id, title, content, position, created_by, deleted_at, deleted_by, profiles:deleted_by(handle)')
      .eq('session_id', sessionId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
  };

  useEffect(() => { load(); }, [sessionId]);

  const doRestore = async (row) => {
    if (busyId) return;
    setBusyId(row.id);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { onMsg?.('Not signed in'); setBusyId(''); return; }
    const { error } = await supabase
      .from('story_pages')
      .update({ deleted_at: null, deleted_by: null, updated_by: user.id })
      .eq('id', row.id);
    setBusyId('');
    if (error) { onMsg?.(`Restore failed: ${error.message}`); return; }
    onMsg?.(`Restored "${row.title || 'Untitled'}"`);
    load();
  };

  const doPurge = async () => {
    const row = confirmPurge;
    setConfirmPurge(null);
    if (!row) return;
    setBusyId(row.id);
    const { error } = await supabase.from('story_pages').delete().eq('id', row.id);
    setBusyId('');
    if (error) { onMsg?.(`Purge failed: ${error.message}`); return; }
    onMsg?.('Permanently deleted');
    load();
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: G.bg, border: `1px solid ${G.gold}55`, borderRadius: 6,
        width: '100%', maxWidth: 460, maxHeight: '85dvh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 10px 40px #000a',
      }}>
        <div style={{
          padding: '14px 16px', borderBottom: `1px solid ${G.goldFaint}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ fontFamily: 'Cinzel Decorative,serif', fontSize: 16, color: G.gold }}>
              Chapter Trash
            </div>
            <div style={{ fontFamily: 'EB Garamond,serif', fontStyle: 'italic', fontSize: 12, color: G.muted, marginTop: 1 }}>
              Deleted chapters stay here until permanently purged.
            </div>
          </div>
          <button onClick={onClose} style={{
            fontFamily: 'Cinzel,serif', fontSize: 16, lineHeight: 1, color: G.goldDim,
            border: `1px solid ${G.gold}44`, borderRadius: 3, background: 'transparent',
            padding: '4px 10px', cursor: 'pointer', flexShrink: 0,
          }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
          {rows === null && <div style={{ color: G.muted, fontStyle: 'italic', textAlign: 'center', padding: '28px 0' }}>Loading…</div>}
          {err && (
            <div style={{
              margin: '8px 0', padding: '8px 10px', background: `${G.red}15`,
              border: `1px solid ${G.red}55`, borderRadius: 3, color: G.red, fontSize: 12,
            }}>{err}</div>
          )}
          {rows !== null && rows.length === 0 && !err && (
            <div style={{ color: G.goldDim, fontStyle: 'italic', textAlign: 'center', padding: '28px 0' }}>
              No deleted chapters.
            </div>
          )}
          {(rows || []).map((row) => {
            const ts    = row.deleted_at ? new Date(row.deleted_at).toLocaleString() : '';
            const by    = row.profiles?.handle ? `by ${row.profiles.handle}` : '';
            const rowBusy = busyId === row.id;
            const preview = (row.content || '').replace(/\s+/g, ' ').slice(0, 120);
            return (
              <div key={row.id} style={{
                background: G.card, border: `1px solid ${G.border}`, borderRadius: 4,
                padding: '10px 12px', marginBottom: 10, opacity: rowBusy ? 0.5 : 1,
              }}>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 14, color: G.gold }}>
                  {row.title || 'Untitled'}
                </div>
                {preview && (
                  <div style={{ fontFamily: 'EB Garamond,serif', fontStyle: 'italic', fontSize: 12, color: G.textDim, marginTop: 4, lineHeight: 1.4 }}>
                    {preview}{(row.content || '').length > 120 ? '…' : ''}
                  </div>
                )}
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, color: `${G.gold}66`, marginTop: 6 }}>
                  Deleted {ts} {by}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => doRestore(row)}
                    disabled={rowBusy}
                    style={{
                      fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                      border: `1px solid ${G.gold}66`, borderRadius: 3, background: 'transparent',
                      color: G.gold, padding: '6px 12px', cursor: rowBusy ? 'default' : 'pointer',
                    }}
                  >↻ Restore</button>
                  <button
                    onClick={() => setConfirmPurge(row)}
                    disabled={rowBusy}
                    style={{
                      fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                      border: `1px solid ${G.red}88`, borderRadius: 3, background: 'transparent',
                      color: G.red, padding: '6px 12px', cursor: rowBusy ? 'default' : 'pointer',
                    }}
                  >✕ Delete forever</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirmPurge && (
        <div onClick={(e) => { e.stopPropagation(); setConfirmPurge(null); }} style={{
          position: 'fixed', inset: 0, zIndex: 401, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: G.card, border: `1px solid ${G.red}88`, borderRadius: 6,
            padding: '20px 18px', maxWidth: 340, width: '100%',
          }}>
            <div style={{ fontFamily: 'EB Garamond,serif', fontSize: 15, color: G.text, lineHeight: 1.5 }}>
              Permanently delete <strong style={{ color: G.gold }}>{confirmPurge.title || 'Untitled'}</strong>?
              <div style={{ fontSize: 12, color: G.muted, marginTop: 8 }}>
                This cannot be undone — the chapter's content will be lost forever.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setConfirmPurge(null)} style={{
                fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                border: `1px solid ${G.border}`, borderRadius: 3, background: 'transparent',
                color: G.muted, padding: '8px 14px', cursor: 'pointer',
              }}>CANCEL</button>
              <button onClick={doPurge} style={{
                fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                border: `1px solid ${G.red}`, borderRadius: 3, background: 'transparent',
                color: G.red, padding: '8px 14px', cursor: 'pointer',
              }}>DELETE FOREVER</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
