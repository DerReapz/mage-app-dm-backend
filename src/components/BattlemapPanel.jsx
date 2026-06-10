import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Card, Label, Toast } from './SharedUI.jsx';

const COLORS = ['#c8a84b', '#c03030', '#5cad8f', '#7ab8c8', '#c4a0e8', '#e8d9b0', '#080808'];
const THICKNESSES = [2, 4, 8, 14];

// Get-or-create the single battlemap row for this session.
async function ensureBattlemap(sessionId) {
  const { data: existing, error: e1 } = await supabase
    .from('battlemaps')
    .select('id, name, background_url, width, height, updated_at')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('battlemaps')
    .insert({ session_id: sessionId, name: 'Battlemap', created_by: user?.id, updated_by: user?.id })
    .select('id, name, background_url, width, height, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export default function BattlemapPanel({ sessionId }) {
  const G = useTheme();
  const [map,      setMap]      = useState(null);
  const [strokes,  setStrokes]  = useState([]);
  const [tokens,   setTokens]   = useState([]);
  const [members,  setMembers]  = useState([]); // [{ player_id, handle }]
  const [me,       setMe]       = useState(null);
  const [isDM,     setIsDM]     = useState(false);
  const [color,    setColor]    = useState(COLORS[0]);
  const [thick,    setThick]    = useState(THICKNESSES[1]);
  const [mode,     setMode]     = useState('draw'); // draw | erase | move
  const [busy,     setBusy]     = useState(false);
  const [toast,    setToast]    = useState('');
  const [adding,   setAdding]   = useState(false); // add-token modal

  const wrapperRef = useRef(null);
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const liveStroke = useRef(null);       // { color, thickness, points: [{x,y}] }
  const drawingId  = useRef(null);       // pointerId currently drawing
  const dragRef    = useRef(null);       // { tokenId, pointerId, dx, dy }
  const strokesRef = useRef([]);         // mirror so redraw() inside live handlers always reads fresh
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  const toast2 = (m, ms = 3000) => { setToast(m); setTimeout(() => setToast(''), ms); };

  // ── Auth + session role ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user || null);
      if (!user) return;
      const { data: s } = await supabase
        .from('game_sessions').select('dm_id').eq('id', sessionId).maybeSingle();
      setIsDM(!!s && s.dm_id === user.id);
    })();
  }, [sessionId]);

  // ── Load map + strokes + tokens + members ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await ensureBattlemap(sessionId);
        if (cancelled) return;
        setMap(m);

        const [{ data: sRows }, { data: tRows }, { data: mRows }] = await Promise.all([
          supabase.from('battlemap_strokes')
            .select('id, color, thickness, points, created_by, created_at')
            .eq('battlemap_id', m.id).order('created_at', { ascending: true }),
          supabase.from('battlemap_tokens')
            .select('id, player_id, label, color, x, y, created_by')
            .eq('battlemap_id', m.id),
          supabase.from('session_members')
            .select('player_id, profiles:player_id(handle)')
            .eq('session_id', sessionId),
        ]);
        if (cancelled) return;
        setStrokes(sRows || []);
        setTokens(tRows || []);
        setMembers((mRows || []).map((r) => ({ player_id: r.player_id, handle: r.profiles?.handle || '—' })));
      } catch (e) {
        if (!cancelled) toast2(`Battlemap load failed: ${e.message}`, 6000);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // ── Realtime subscriptions ────────────────────────────────────────────
  useEffect(() => {
    if (!map?.id) return;
    const ch = supabase.channel(`battlemap-${map.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'battlemap_strokes', filter: `battlemap_id=eq.${map.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setStrokes((p) => [...p, payload.new]);
          else if (payload.eventType === 'DELETE') setStrokes((p) => p.filter((s) => s.id !== payload.old.id));
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'battlemap_tokens', filter: `battlemap_id=eq.${map.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT')
            setTokens((p) => p.some((t) => t.id === payload.new.id) ? p : [...p, payload.new]);
          else if (payload.eventType === 'UPDATE')
            setTokens((p) => p.map((t) => (t.id === payload.new.id ? { ...t, ...payload.new } : t)));
          else if (payload.eventType === 'DELETE')
            setTokens((p) => p.filter((t) => t.id !== payload.old.id));
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'battlemaps', filter: `id=eq.${map.id}` },
        (payload) => setMap((p) => ({ ...p, ...payload.new })))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [map?.id]);

  // ── Background image loader (kept ref so we can redraw fast) ───────────
  useEffect(() => {
    if (!map?.background_url) { imgRef.current = null; redraw(); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { imgRef.current = img; redraw(); };
    img.onerror = () => { imgRef.current = null; redraw(); };
    img.src = map.background_url;
  }, [map?.background_url]);

  // ── Canvas redraw ─────────────────────────────────────────────────────
  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // Background fill so the canvas reads as a map even without an image.
    ctx.fillStyle = '#1a1408';
    ctx.fillRect(0, 0, w, h);
    if (imgRef.current) {
      // contain
      const img = imgRef.current;
      const r = Math.min(w / img.width, h / img.height);
      const iw = img.width * r, ih = img.height * r;
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }
    const drawStroke = (s) => {
      const pts = Array.isArray(s.points) ? s.points : [];
      if (pts.length < 1) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = s.color; ctx.lineWidth = s.thickness;
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
      if (pts.length === 1) { ctx.lineTo(pts[0].x * w + 0.1, pts[0].y * h + 0.1); }
      ctx.stroke();
    };
    for (const s of strokesRef.current) drawStroke(s);
    if (liveStroke.current) drawStroke(liveStroke.current);
  };

  // Resize canvas to wrapper width while keeping the map's aspect ratio.
  useEffect(() => {
    if (!map) return;
    const fit = () => {
      const wrap = wrapperRef.current, canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const w = wrap.clientWidth;
      const aspect = (map.height || 768) / (map.width || 1024);
      const h = Math.max(180, Math.round(w * aspect));
      canvas.width = w; canvas.height = h;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [map?.width, map?.height]);

  useEffect(() => { redraw(); }, [strokes, map?.background_url]);

  // ── Drawing handlers ──────────────────────────────────────────────────
  const norm = (e) => {
    const canvas = canvasRef.current;
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onCanvasPointerDown = (e) => {
    if (mode === 'move') return;          // move mode reserves the canvas for tokens
    if (drawingId.current != null) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawingId.current = e.pointerId;
    liveStroke.current = { color: mode === 'erase' ? '#1a1408' : color, thickness: thick, points: [norm(e)] };
    redraw();
  };
  const onCanvasPointerMove = (e) => {
    if (drawingId.current !== e.pointerId || !liveStroke.current) return;
    liveStroke.current.points.push(norm(e));
    redraw();
  };
  const onCanvasPointerUp = async (e) => {
    if (drawingId.current !== e.pointerId) return;
    drawingId.current = null;
    try { canvasRef.current.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const s = liveStroke.current;
    liveStroke.current = null;
    if (!s || !map || !me) return;
    if (s.points.length < 2) { redraw(); return; }
    setBusy(true);
    const { data, error } = await supabase
      .from('battlemap_strokes')
      .insert({ battlemap_id: map.id, color: s.color, thickness: s.thickness, points: s.points, created_by: me.id })
      .select('id, color, thickness, points, created_by, created_at')
      .single();
    setBusy(false);
    if (error) { toast2(`Draw failed: ${error.message}`, 5000); redraw(); return; }
    setStrokes((p) => p.some((x) => x.id === data.id) ? p : [...p, data]);
  };

  const clearMyStrokes = async () => {
    if (!map || !me) return;
    if (!window.confirm('Erase all strokes you have drawn on this map?')) return;
    const { error } = await supabase
      .from('battlemap_strokes')
      .delete()
      .eq('battlemap_id', map.id)
      .eq('created_by', me.id);
    if (error) { toast2(`Clear failed: ${error.message}`, 5000); return; }
    setStrokes((p) => p.filter((s) => s.created_by !== me.id));
  };

  const clearAllStrokes = async () => {
    if (!map) return;
    if (!window.confirm('Erase every stroke on this map for all campaign members?')) return;
    const { error } = await supabase.from('battlemap_strokes').delete().eq('battlemap_id', map.id);
    if (error) { toast2(`Clear failed: ${error.message}`, 5000); return; }
    setStrokes([]);
  };

  // ── Background image upload ──────────────────────────────────────────
  const uploadBackground = async (file) => {
    if (!file || !map) return;
    setBusy(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${sessionId}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from('battlemaps').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type || `image/${ext}`,
      });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from('battlemaps').getPublicUrl(path);
      // Read native dimensions to set the canvas aspect.
      const dims = await new Promise((resolve) => {
        const img = new Image();
        img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 1024, h: 768 });
        img.src = pub.publicUrl;
      });
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('battlemaps')
        .update({ background_url: pub.publicUrl, width: dims.w, height: dims.h, updated_by: user?.id })
        .eq('id', map.id)
        .select('id, name, background_url, width, height, updated_at').single();
      if (error) throw error;
      setMap(data);
      toast2('Background uploaded ✓');
    } catch (e) { toast2(`Upload failed: ${e.message}`, 6000); }
    finally { setBusy(false); }
  };

  // ── Token interactions ───────────────────────────────────────────────
  const canMoveToken = (tk) => isDM || tk.player_id === me?.id;

  const onTokenPointerDown = (tk, e) => {
    if (!canMoveToken(tk)) return;
    e.stopPropagation();
    e.preventDefault();
    const wrap = wrapperRef.current.getBoundingClientRect();
    const startX = tk.x, startY = tk.y;
    dragRef.current = {
      tokenId: tk.id, pointerId: e.pointerId, startX, startY,
      grabClientX: e.clientX, grabClientY: e.clientY, wrap,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onTokenPointerMove = (tk, e) => {
    const d = dragRef.current;
    if (!d || d.tokenId !== tk.id || d.pointerId !== e.pointerId) return;
    const nx = Math.min(1, Math.max(0, d.startX + (e.clientX - d.grabClientX) / d.wrap.width));
    const ny = Math.min(1, Math.max(0, d.startY + (e.clientY - d.grabClientY) / d.wrap.height));
    setTokens((p) => p.map((t) => (t.id === tk.id ? { ...t, x: nx, y: ny } : t)));
  };
  const onTokenPointerUp = async (tk, e) => {
    const d = dragRef.current;
    if (!d || d.tokenId !== tk.id || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const live = tokens.find((t) => t.id === tk.id);
    if (!live) return;
    if (Math.abs(live.x - d.startX) < 0.002 && Math.abs(live.y - d.startY) < 0.002) return;
    const { error } = await supabase
      .from('battlemap_tokens').update({ x: live.x, y: live.y }).eq('id', tk.id);
    if (error) toast2(`Move failed: ${error.message}`, 5000);
  };

  const deleteToken = async (tk) => {
    if (!canMoveToken(tk)) return;
    if (!window.confirm(`Remove token "${tk.label}" from the map?`)) return;
    const { error } = await supabase.from('battlemap_tokens').delete().eq('id', tk.id);
    if (error) toast2(`Delete failed: ${error.message}`, 5000);
  };

  // ── Add-token modal ─────────────────────────────────────────────────
  const memberOptions = useMemo(() => {
    // The DM may add a token for any session member. A player may add only a
    // token for themselves (RLS will reject anything else anyway).
    if (!me) return [];
    if (isDM) return members;
    return members.filter((m) => m.player_id === me.id);
  }, [members, isDM, me?.id]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <Label style={{ marginBottom: 0 }}>Battlemap (shared with players)</Label>
        <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.12em', color: G.muted }}>
          {tokens.length} token{tokens.length === 1 ? '' : 's'} · {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {/* Tool mode */}
        {['draw', 'erase', 'move'].map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
            border: `1px solid ${mode === m ? G.gold : G.border}`, borderRadius: 3,
            background: mode === m ? `${G.gold}1e` : 'transparent',
            color: mode === m ? G.gold : G.muted, padding: '5px 10px', cursor: 'pointer',
          }}>{m.toUpperCase()}</button>
        ))}

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); setMode('draw'); }}
              aria-label={`Color ${c}`}
              style={{
                width: 22, height: 22, borderRadius: '50%',
                border: `2px solid ${c === color ? G.gold : G.border}`,
                background: c, cursor: 'pointer',
              }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {THICKNESSES.map((t) => (
            <button key={t} onClick={() => { setThick(t); setMode('draw'); }}
              aria-label={`Thickness ${t}`}
              style={{
                width: 24, height: 24, borderRadius: 3, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${t === thick ? G.gold : G.border}`,
                background: 'transparent', cursor: 'pointer',
              }}>
              <span style={{ display: 'inline-block', width: 14, height: t, background: color, borderRadius: t / 2 }} />
            </button>
          ))}
        </div>

        <label style={{
          fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
          border: `1px solid ${G.gold}66`, borderRadius: 3, color: G.goldDim,
          padding: '5px 10px', cursor: 'pointer', background: 'transparent',
        }}>
          ↑ BACKGROUND
          <input type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBackground(f); e.target.value = ''; }} />
        </label>

        <button onClick={() => setAdding(true)} disabled={!me || !map} style={{
          fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
          border: `1px solid ${G.gold}66`, borderRadius: 3, background: 'transparent',
          color: G.goldDim, padding: '5px 10px', cursor: !me || !map ? 'default' : 'pointer',
          opacity: !me || !map ? 0.5 : 1,
        }}>+ TOKEN</button>

        <button onClick={clearMyStrokes} style={{
          fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
          border: `1px solid ${G.red}66`, borderRadius: 3, background: 'transparent',
          color: G.red, padding: '5px 10px', cursor: 'pointer',
        }}>✕ MY INK</button>

        {isDM && (
          <button onClick={clearAllStrokes} style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
            border: `1px solid ${G.red}`, borderRadius: 3, background: 'transparent',
            color: G.red, padding: '5px 10px', cursor: 'pointer',
          }}>✕ ALL INK</button>
        )}
      </div>

      {/* Canvas + tokens overlay */}
      <div ref={wrapperRef} style={{ position: 'relative', width: '100%', userSelect: 'none', touchAction: 'none', overflow: 'hidden', borderRadius: 3, border: `1px solid ${G.border}` }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          style={{ display: 'block', width: '100%', background: '#1a1408', cursor: mode === 'move' ? 'default' : 'crosshair' }}
        />
        {/* Tokens layer */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {tokens.map((tk) => {
            const movable = canMoveToken(tk);
            const handle = members.find((m) => m.player_id === tk.player_id)?.handle;
            return (
              <div key={tk.id}
                onPointerDown={(e) => onTokenPointerDown(tk, e)}
                onPointerMove={(e) => onTokenPointerMove(tk, e)}
                onPointerUp={(e)   => onTokenPointerUp(tk, e)}
                onPointerCancel={(e) => onTokenPointerUp(tk, e)}
                onDoubleClick={() => deleteToken(tk)}
                title={handle ? `${tk.label} · ${handle}${movable ? ' · double-click to remove' : ''}` : tk.label}
                style={{
                  position: 'absolute',
                  left: `calc(${tk.x * 100}% - 20px)`,
                  top:  `calc(${tk.y * 100}% - 20px)`,
                  width: 40, height: 40, borderRadius: '50%',
                  background: tk.color, border: `2px solid ${movable ? '#fff8' : '#0006'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Cinzel,serif', fontSize: 12, color: '#0a0a0a',
                  cursor: movable ? 'grab' : 'not-allowed', pointerEvents: 'auto',
                  boxShadow: '0 2px 6px #0008',
                  touchAction: 'none',
                }}
              >{(tk.label || '?').slice(0, 2).toUpperCase()}</div>
            );
          })}
        </div>
      </div>

      <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.12em', color: G.muted, marginTop: 6 }}>
        {busy ? 'Saving…' : (mode === 'move' ? 'Drag tokens. Double-click yours to remove.' :
          mode === 'erase' ? 'Erase strokes by drawing over them.' :
          'Draw on the map. Tokens stay on top.')}
      </div>

      {adding && (
        <AddTokenModal
          G={G}
          options={memberOptions}
          defaultPlayerId={me?.id || null}
          defaultColor={color}
          onCancel={() => setAdding(false)}
          onCreate={async ({ label, color, playerId }) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { toast2('Not signed in'); setAdding(false); return; }
            const ownerId = isDM ? (playerId || user.id) : user.id;
            const { error } = await supabase
              .from('battlemap_tokens')
              .insert({
                battlemap_id: map.id, player_id: ownerId, label: label || '?',
                color: color || '#c8a84b', x: 0.5, y: 0.5, created_by: user.id,
              });
            setAdding(false);
            if (error) toast2(`Add failed: ${error.message}`, 6000);
          }}
        />
      )}

      <Toast msg={toast} />
    </Card>
  );
}

function AddTokenModal({ G, options, defaultPlayerId, defaultColor, onCancel, onCreate }) {
  const [label,    setLabel]    = useState('');
  const [color,    setColor]    = useState(defaultColor);
  const [playerId, setPlayerId] = useState(defaultPlayerId);
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: G.card, border: `1px solid ${G.gold}55`, borderRadius: 6,
        padding: '16px', width: '100%', maxWidth: 360,
      }}>
        <div style={{ fontFamily: 'Cinzel Decorative,serif', fontSize: 15, color: G.gold, marginBottom: 10 }}>
          Add token
        </div>

        <div style={{ marginBottom: 10 }}>
          <Label>Label</Label>
          <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 6))}
            maxLength={6} placeholder="e.g. EL"
            style={{ width: '100%', boxSizing: 'border-box', background: G.surface, border: `1px solid ${G.border}`, color: G.text, fontFamily: 'EB Garamond,serif', fontSize: 14, padding: '7px 9px', borderRadius: 2 }} />
        </div>

        <div style={{ marginBottom: 10 }}>
          <Label>Color</Label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
                style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${c === color ? G.gold : G.border}`, background: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <Label>Controlled by</Label>
          <select value={playerId || ''} onChange={(e) => setPlayerId(e.target.value)}
            disabled={options.length <= 1}
            style={{ width: '100%', boxSizing: 'border-box', background: G.surface, border: `1px solid ${G.border}`, color: G.text, fontFamily: 'EB Garamond,serif', fontSize: 13, padding: '7px 9px', borderRadius: 2 }}>
            {options.map((o) => (
              <option key={o.player_id} value={o.player_id}>{o.handle}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: G.muted, marginTop: 4 }}>
            Only this user (or the DM) can move the token.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
            border: `1px solid ${G.border}`, borderRadius: 3, background: 'transparent',
            color: G.muted, padding: '8px 14px', cursor: 'pointer',
          }}>CANCEL</button>
          <button onClick={() => onCreate({ label, color, playerId })} style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
            border: `1px solid ${G.gold}`, borderRadius: 3, background: 'transparent',
            color: G.gold, padding: '8px 14px', cursor: 'pointer',
          }}>CREATE</button>
        </div>
      </div>
    </div>
  );
}
