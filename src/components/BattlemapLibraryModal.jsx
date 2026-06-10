import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Label } from './SharedUI.jsx';

// DM-only library of battlemap images for a session. Lets the DM upload
// multiple maps to a persistent collection and toggle which one is the
// active background. The collection is gated to the DM via the
// battlemap_library_dm_all RLS policy.
export default function BattlemapLibraryModal({ sessionId, currentUrl, onClose, onUse, onMsg }) {
  const G = useTheme();
  const [rows,    setRows]    = useState(null); // null = loading
  const [err,     setErr]     = useState('');
  const [busyId,  setBusyId]  = useState('');   // entry id mid-action, or '*' for upload
  const [confirmDel, setConfirmDel] = useState(null);
  const [renaming,   setRenaming]   = useState(null); // { id, name }
  const fileRef = useRef(null);

  const load = async () => {
    setErr('');
    const { data, error } = await supabase
      .from('battlemap_library')
      .select('id, name, url, width, height, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
  };

  useEffect(() => { load(); }, [sessionId]);

  // Realtime: a DM editing the library on another device sees updates here too.
  useEffect(() => {
    const ch = supabase
      .channel(`battlemap-library-${sessionId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'battlemap_library', filter: `session_id=eq.${sessionId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId]);

  const onPickFile = () => fileRef.current?.click();

  const doUpload = async (file) => {
    if (!file) return;
    setBusyId('*');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${sessionId}/library/${Date.now()}.${ext}`;
      const up = await supabase.storage.from('battlemaps').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type || `image/${ext}`,
      });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from('battlemaps').getPublicUrl(path);
      const dims = await new Promise((resolve) => {
        const img = new Image();
        img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 1024, h: 768 });
        img.src = pub.publicUrl;
      });
      const niceName = file.name.replace(/\.[^.]+$/, '').slice(0, 64) || 'Untitled map';
      const { error } = await supabase
        .from('battlemap_library')
        .insert({
          session_id: sessionId, name: niceName, url: pub.publicUrl,
          width: dims.w, height: dims.h, created_by: user?.id,
        });
      if (error) throw error;
      onMsg?.(`Added "${niceName}" to library`);
      load();
    } catch (e) { onMsg?.(`Upload failed: ${e.message}`); }
    finally { setBusyId(''); }
  };

  const doUse = async (row) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await onUse?.(row);
      onMsg?.(`Now using "${row.name}"`);
    } catch (e) { onMsg?.(`Switch failed: ${e.message}`); }
    finally { setBusyId(''); }
  };

  const doDelete = async () => {
    const row = confirmDel;
    setConfirmDel(null);
    if (!row) return;
    setBusyId(row.id);
    try {
      // Best-effort: drop the storage object too. Failure to remove the file
      // is non-fatal; the library row is what matters.
      const match = row.url.match(/\/battlemaps\/(.+?)(\?|$)/);
      const path = match ? decodeURIComponent(match[1]) : null;
      const { error } = await supabase.from('battlemap_library').delete().eq('id', row.id);
      if (error) throw error;
      if (path) await supabase.storage.from('battlemaps').remove([path]).catch(() => {});
      onMsg?.('Removed from library');
      load();
    } catch (e) { onMsg?.(`Delete failed: ${e.message}`); }
    finally { setBusyId(''); }
  };

  const commitRename = async () => {
    const job = renaming;
    setRenaming(null);
    if (!job) return;
    const t = (job.name || '').trim();
    if (!t) return;
    const { error } = await supabase
      .from('battlemap_library').update({ name: t.slice(0, 80) }).eq('id', job.id);
    if (error) onMsg?.(`Rename failed: ${error.message}`);
    else load();
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: G.bg, border: `1px solid ${G.gold}55`, borderRadius: 6,
        width: '100%', maxWidth: 560, maxHeight: '85dvh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 10px 40px #000a',
      }}>
        <div style={{
          padding: '14px 16px', borderBottom: `1px solid ${G.goldFaint}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ fontFamily: 'Cinzel Decorative,serif', fontSize: 16, color: G.gold }}>
              Battlemap Library
            </div>
            <div style={{ fontFamily: 'EB Garamond,serif', fontStyle: 'italic', fontSize: 12, color: G.muted, marginTop: 1 }}>
              Maps stored for this chronicle. Click <strong style={{ color: G.gold }}>Use</strong> to swap the active background.
            </div>
          </div>
          <button onClick={onClose} style={{
            fontFamily: 'Cinzel,serif', fontSize: 16, lineHeight: 1, color: G.goldDim,
            border: `1px solid ${G.gold}44`, borderRadius: 3, background: 'transparent',
            padding: '4px 10px', cursor: 'pointer', flexShrink: 0,
          }}>✕</button>
        </div>

        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${G.goldFaint}` }}>
          <button onClick={onPickFile} disabled={busyId === '*'}
            style={{
              fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.18em',
              border: `1px solid ${G.gold}`, borderRadius: 3, background: 'transparent',
              color: G.gold, padding: '8px 14px', cursor: busyId === '*' ? 'default' : 'pointer',
              opacity: busyId === '*' ? 0.5 : 1,
            }}>
            {busyId === '*' ? 'Uploading…' : '↑ ADD MAP TO LIBRARY'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ''; }} />
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
              No maps stored yet. Upload one above.
            </div>
          )}

          {(rows || []).map((row) => {
            const isActive = currentUrl && row.url === currentUrl;
            const rowBusy  = busyId === row.id;
            const ts       = row.created_at ? new Date(row.created_at).toLocaleString() : '';
            const renameThis = renaming?.id === row.id;
            return (
              <div key={row.id} style={{
                background: G.card, border: `1px solid ${isActive ? G.gold : G.border}`,
                borderRadius: 4, padding: '10px 12px', marginBottom: 10,
                opacity: rowBusy ? 0.6 : 1,
                display: 'flex', gap: 12, alignItems: 'center',
              }}>
                <img src={row.url} alt={row.name}
                  style={{
                    width: 80, height: 60, objectFit: 'cover',
                    borderRadius: 3, border: `1px solid ${G.border}`,
                    background: '#000', flexShrink: 0,
                  }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renameThis ? (
                    <input autoFocus value={renaming.name}
                      onChange={(e) => setRenaming({ id: row.id, name: e.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                      style={{
                        width: '100%', boxSizing: 'border-box', background: G.surface,
                        border: `1px solid ${G.gold}66`, color: G.text,
                        fontFamily: 'Cinzel,serif', fontSize: 13, padding: '4px 8px', borderRadius: 2,
                      }} />
                  ) : (
                    <div
                      onClick={() => setRenaming({ id: row.id, name: row.name })}
                      title="Click to rename"
                      style={{
                        fontFamily: 'Cinzel,serif', fontSize: 13, color: G.gold,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: 'text',
                      }}>{row.name} <span style={{ color: G.muted, fontSize: 10 }}>✎</span></div>
                  )}
                  <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, color: `${G.gold}66`, marginTop: 3 }}>
                    {row.width}×{row.height} · {ts}
                  </div>
                  {isActive && (
                    <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.18em', color: G.teal, marginTop: 4 }}>
                      ★ ACTIVE BACKGROUND
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => doUse(row)} disabled={rowBusy || isActive}
                    style={{
                      fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                      border: `1px solid ${isActive ? G.border : G.gold}`, borderRadius: 3,
                      background: 'transparent', color: isActive ? G.muted : G.gold,
                      padding: '6px 12px', cursor: rowBusy || isActive ? 'default' : 'pointer',
                    }}>{isActive ? 'IN USE' : '→ USE'}</button>
                  <button onClick={() => setConfirmDel(row)} disabled={rowBusy}
                    style={{
                      fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                      border: `1px solid ${G.red}88`, borderRadius: 3, background: 'transparent',
                      color: G.red, padding: '6px 12px', cursor: rowBusy ? 'default' : 'pointer',
                    }}>✕ DELETE</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirmDel && (
        <div onClick={(e) => { e.stopPropagation(); setConfirmDel(null); }} style={{
          position: 'fixed', inset: 0, zIndex: 401, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: G.card, border: `1px solid ${G.red}88`, borderRadius: 6,
            padding: '20px 18px', maxWidth: 340, width: '100%',
          }}>
            <div style={{ fontFamily: 'EB Garamond,serif', fontSize: 15, color: G.text, lineHeight: 1.5 }}>
              Permanently delete <strong style={{ color: G.gold }}>{confirmDel.name}</strong> from the library?
              {currentUrl && confirmDel.url === currentUrl && (
                <div style={{ fontSize: 12, color: G.red, marginTop: 8 }}>
                  This is the active background. Deleting it from the library will <em>not</em> remove it from the map until you upload or pick another.
                </div>
              )}
              <div style={{ fontSize: 12, color: G.muted, marginTop: 8 }}>
                The image file is also removed from storage. This cannot be undone.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setConfirmDel(null)} style={{
                fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                border: `1px solid ${G.border}`, borderRadius: 3, background: 'transparent',
                color: G.muted, padding: '8px 14px', cursor: 'pointer',
              }}>CANCEL</button>
              <button onClick={doDelete} style={{
                fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                border: `1px solid ${G.red}`, borderRadius: 3, background: 'transparent',
                color: G.red, padding: '8px 14px', cursor: 'pointer',
              }}>DELETE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
