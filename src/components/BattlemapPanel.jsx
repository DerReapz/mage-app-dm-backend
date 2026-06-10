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
    .select('id, name, background_url, background_locked, width, height, updated_at')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('battlemaps')
    .insert({ session_id: sessionId, name: 'Battlemap', created_by: user?.id, updated_by: user?.id })
    .select('id, name, background_url, background_locked, width, height, updated_at')
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
  const [, bumpHistory] = useState(0);

  const wrapperRef = useRef(null);
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const liveStroke = useRef(null);       // { color, thickness, points: [{x,y}] }
  const drawingId  = useRef(null);       // pointerId currently drawing
  const dragRef    = useRef(null);       // { tokenId, pointerId, dx, dy }
  const strokesRef = useRef([]);         // mirror so redraw() inside live handlers always reads fresh
  const erasingRef = useRef(null);       // { ids: Set<string>, rows: stroke[] } while erasing
  const undoRef    = useRef([]);         // local undo stack (entries shaped { kind, ids?, data })
  const redoRef    = useRef([]);
  const meRef      = useRef(null);
  const isDMRef    = useRef(false);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { meRef.current = me; }, [me]);
  useEffect(() => { isDMRef.current = isDM; }, [isDM]);
  // Clear undo/redo when the session changes — history is meaningful only
  // within a single map and only for the local user's own actions.
  useEffect(() => {
    undoRef.current = [];
    redoRef.current = [];
    bumpHistory((t) => t + 1);
  }, [sessionId]);

  const pushUndo = (entry) => {
    undoRef.current.push(entry);
    redoRef.current = [];
    bumpHistory((t) => t + 1);
  };

  // Insert a batch of strokes (used by undo of an erase + redo of a draw).
  // Preserves the original created_by when present so undoing a DM erase of
  // a player's stroke restores the original author, not the DM. RLS allows
  // this because the DM's dm_all policy doesn't constrain created_by; for a
  // non-DM, the only undoable strokes are their own anyway (eraser is gated
  // to own strokes), so created_by always equals auth.uid().
  // Returns the inserted rows so the caller can record their new ids.
  const insertStrokeBatch = async (data) => {
    if (!map || !meRef.current || data.length === 0) return [];
    const rows = data.map((d) => ({
      battlemap_id: map.id, color: d.color, thickness: d.thickness,
      points: d.points, created_by: d.created_by || meRef.current.id,
    }));
    const { data: inserted, error } = await supabase
      .from('battlemap_strokes')
      .insert(rows)
      .select('id, color, thickness, points, created_by, created_at');
    if (error) throw error;
    setStrokes((p) => {
      const haveId = new Set(p.map((s) => s.id));
      return [...p, ...(inserted || []).filter((s) => !haveId.has(s.id))];
    });
    return inserted || [];
  };

  // Apply the inverse of a history entry. Returns the new entry that should
  // be pushed onto the opposite stack so the operation is itself reversible.
  const applyInverse = async (entry) => {
    if (entry.kind === 'add') {
      const { error } = await supabase
        .from('battlemap_strokes').delete().in('id', entry.ids);
      if (error) throw error;
      setStrokes((p) => p.filter((s) => !entry.ids.includes(s.id)));
      return { kind: 'remove', data: entry.data };
    }
    const inserted = await insertStrokeBatch(entry.data);
    return { kind: 'add', ids: inserted.map((r) => r.id), data: entry.data };
  };

  const doUndo = async () => {
    if (busy) return;
    const top = undoRef.current.pop();
    if (!top) { bumpHistory((t) => t + 1); return; }
    bumpHistory((t) => t + 1);
    try {
      const inverse = await applyInverse(top);
      redoRef.current.push(inverse);
    } catch (e) {
      undoRef.current.push(top);
      toast2(`Undo failed: ${e.message}`, 5000);
    }
    bumpHistory((t) => t + 1);
  };

  const doRedo = async () => {
    if (busy) return;
    const top = redoRef.current.pop();
    if (!top) { bumpHistory((t) => t + 1); return; }
    bumpHistory((t) => t + 1);
    try {
      const inverse = await applyInverse(top);
      undoRef.current.push(inverse);
    } catch (e) {
      redoRef.current.push(top);
      toast2(`Redo failed: ${e.message}`, 5000);
    }
    bumpHistory((t) => t + 1);
  };

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

  // True eraser: when the eraser circle intersects a stroke point we're
  // allowed to delete (own strokes for players, anything for the DM), the
  // stroke is removed. The radius is taken from the current thickness.
  const eraseAtPoint = (p) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const radius = Math.max(8, thick * 1.5);
    const rSq = radius * radius;
    const w = canvas.width, h = canvas.height;
    const hitIds = [];
    const hitRows = [];
    const dm = isDMRef.current;
    const myId = meRef.current?.id;
    for (const s of strokesRef.current) {
      if (erasingRef.current.ids.has(s.id)) continue;
      if (!dm && s.created_by !== myId) continue;
      const pts = Array.isArray(s.points) ? s.points : [];
      for (const pt of pts) {
        const dx = (pt.x - p.x) * w;
        const dy = (pt.y - p.y) * h;
        if (dx * dx + dy * dy <= rSq) {
          hitIds.push(s.id);
          hitRows.push(s);
          break;
        }
      }
    }
    if (hitIds.length === 0) return;
    for (const id of hitIds) erasingRef.current.ids.add(id);
    erasingRef.current.rows.push(...hitRows);
    setStrokes((prev) => prev.filter((s) => !erasingRef.current.ids.has(s.id)));
  };

  const onCanvasPointerDown = (e) => {
    if (mode === 'move') return;          // move mode reserves the canvas for tokens
    if (drawingId.current != null) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawingId.current = e.pointerId;
    if (mode === 'erase') {
      erasingRef.current = { ids: new Set(), rows: [] };
      eraseAtPoint(norm(e));
      return;
    }
    liveStroke.current = { color, thickness: thick, points: [norm(e)] };
    redraw();
  };
  const onCanvasPointerMove = (e) => {
    if (drawingId.current !== e.pointerId) return;
    if (mode === 'erase') { if (erasingRef.current) eraseAtPoint(norm(e)); return; }
    if (!liveStroke.current) return;
    liveStroke.current.points.push(norm(e));
    redraw();
  };
  const onCanvasPointerUp = async (e) => {
    if (drawingId.current !== e.pointerId) return;
    drawingId.current = null;
    try { canvasRef.current.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    if (mode === 'erase') {
      const pending = erasingRef.current;
      erasingRef.current = null;
      if (!pending || pending.ids.size === 0) return;
      const ids = [...pending.ids];
      setBusy(true);
      const { error } = await supabase.from('battlemap_strokes').delete().in('id', ids);
      setBusy(false);
      if (error) {
        // Roll back: restore the strokes we optimistically removed.
        setStrokes((prev) => {
          const have = new Set(prev.map((s) => s.id));
          return [...prev, ...pending.rows.filter((s) => !have.has(s.id))];
        });
        toast2(`Erase failed: ${error.message}`, 5000);
        return;
      }
      pushUndo({
        kind: 'remove',
        data: pending.rows.map((r) => ({ color: r.color, thickness: r.thickness, points: r.points, created_by: r.created_by })),
      });
      return;
    }

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
    pushUndo({ kind: 'add', ids: [data.id], data: [{ color: data.color, thickness: data.thickness, points: data.points }] });
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
        .select('id, name, background_url, background_locked, width, height, updated_at').single();
      if (error) throw error;
      setMap(data);
      toast2('Background uploaded ✓');
    } catch (e) { toast2(`Upload failed: ${e.message}`, 6000); }
    finally { setBusy(false); }
  };

  const deleteBackground = async () => {
    if (!map?.background_url) return;
    if (!window.confirm('Remove the background image? Tokens and strokes stay.')) return;
    setBusy(true);
    try {
      const url = map.background_url;
      const match = url.match(/\/battlemaps\/(.+?)(\?|$)/);
      const path = match ? decodeURIComponent(match[1]) : null;
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('battlemaps')
        .update({ background_url: null, updated_by: user?.id })
        .eq('id', map.id)
        .select('id, name, background_url, background_locked, width, height, updated_at')
        .single();
      if (error) throw error;
      setMap(data);
      if (path) {
        // Best-effort cleanup of the object. RLS may reject for non-owners;
        // not surfacing the error since the visible state is what matters.
        await supabase.storage.from('battlemaps').remove([path]).catch(() => {});
      }
      toast2('Background removed ✓');
    } catch (e) { toast2(`Remove failed: ${e.message}`, 6000); }
    finally { setBusy(false); }
  };

  // DM-only: toggle whether the background image is locked. While locked,
  // session members can't upload or remove the background image (the trigger
  // in the database enforces the same rule, so the lock can't be bypassed by
  // a hand-crafted API call).
  const toggleBackgroundLock = async () => {
    if (!map || !isDM) return;
    const next = !map.background_locked;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('battlemaps')
        .update({ background_locked: next, updated_by: user?.id })
        .eq('id', map.id)
        .select('id, name, background_url, background_locked, width, height, updated_at')
        .single();
      if (error) throw error;
      setMap(data);
      toast2(next ? 'Background locked' : 'Background unlocked');
    } catch (e) { toast2(`Lock failed: ${e.message}`, 6000); }
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

        <button onClick={doUndo} disabled={busy || undoRef.current.length === 0} title="Undo your last action"
          style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
            border: `1px solid ${G.gold}66`, borderRadius: 3, background: 'transparent',
            color: G.goldDim, padding: '5px 10px',
            opacity: undoRef.current.length === 0 ? 0.4 : 1,
            cursor: undoRef.current.length === 0 ? 'default' : 'pointer',
          }}>↶ UNDO</button>
        <button onClick={doRedo} disabled={busy || redoRef.current.length === 0} title="Redo your last undone action"
          style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
            border: `1px solid ${G.gold}66`, borderRadius: 3, background: 'transparent',
            color: G.goldDim, padding: '5px 10px',
            opacity: redoRef.current.length === 0 ? 0.4 : 1,
            cursor: redoRef.current.length === 0 ? 'default' : 'pointer',
          }}>↷ REDO</button>

        {(() => {
          const locked   = !!map?.background_locked;
          const bgDisabled = locked && !isDM;
          const lockTitle = locked && !isDM ? 'Background locked by DM' : 'Upload a background image';
          return (
            <label title={lockTitle} style={{
              fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
              border: `1px solid ${G.gold}66`, borderRadius: 3, color: G.goldDim,
              padding: '5px 10px', cursor: bgDisabled ? 'not-allowed' : 'pointer',
              background: 'transparent', opacity: bgDisabled ? 0.5 : 1,
            }}>
              ↑ BACKGROUND
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={bgDisabled}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBackground(f); e.target.value = ''; }} />
            </label>
          );
        })()}

        {map?.background_url && (() => {
          const locked   = !!map?.background_locked;
          const disabled = locked && !isDM;
          return (
            <button onClick={deleteBackground} disabled={disabled}
              title={disabled ? 'Background locked by DM' : 'Remove the background image'}
              style={{
                fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
                border: `1px solid ${G.red}66`, borderRadius: 3, background: 'transparent',
                color: G.red, padding: '5px 10px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.4 : 1,
              }}>✕ BG</button>
          );
        })()}

        {isDM && (
          <button onClick={toggleBackgroundLock} disabled={busy}
            title={map?.background_locked ? 'Unlock the background' : 'Lock the background so players cannot change it'}
            style={{
              fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
              border: `1px solid ${map?.background_locked ? G.gold : G.border}`, borderRadius: 3,
              background: map?.background_locked ? `${G.gold}1e` : 'transparent',
              color: map?.background_locked ? G.gold : G.goldDim,
              padding: '5px 10px', cursor: 'pointer',
            }}>
            {map?.background_locked ? '🔒 LOCKED' : '🔓 LOCK BG'}
          </button>
        )}
        {!isDM && map?.background_locked && (
          <span title="The DM has locked this background image"
            style={{
              fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.12em',
              color: G.goldDim, padding: '5px 6px',
            }}>🔒 LOCKED</span>
        )}

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
          mode === 'erase' ? (isDM
            ? 'Drag to erase any stroke. Use thickness for the eraser size.'
            : 'Drag to erase strokes you drew. Use thickness for the eraser size.') :
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
