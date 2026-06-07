import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Card, Label, Toast } from './SharedUI.jsx';
import TrashedChaptersModal from './TrashedChaptersModal.jsx';

const byPos = (a, b) =>
  (a.position - b.position) ||
  String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
  String(a.id).localeCompare(String(b.id));

// Shared, collaborative chronicle split into chapters (story_pages). Each
// chapter syncs independently via realtime; editing different chapters never
// collides. The DM can create/rename/delete any chapter.
export default function StoryLogPanel({ sessionId }) {
  const G = useTheme();
  const [pages,    setPages]    = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [status,   setStatus]   = useState('idle'); // idle | loading | saving | error
  const [savedAt,  setSavedAt]  = useState(null);
  const [err,      setErr]      = useState('');
  const [renaming, setRenaming] = useState(false);
  const [userId,   setUserId]   = useState(null);
  const [showTrash, setShowTrash] = useState(false);
  const [trashTick, setTrashTick] = useState(0);
  const [toast,     setToast]     = useState('');

  const toast2 = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const editingRef   = useRef(false);
  const dirtyRef     = useRef(false);
  const lastEditRef  = useRef(0);
  const saveTimerRef = useRef(null);
  const pendingRef   = useRef(null); // { pageId, content }
  const activeIdRef  = useRef(null); // mirror so realtime closures read the current page

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const active = pages.find((p) => p.id === activeId) || null;

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null)); }, []);

  const upsertPage = (row) => setPages((prev) => {
    const i = prev.findIndex((p) => p.id === row.id);
    if (i === -1) return [...prev, row].sort(byPos);
    const next = [...prev];
    next[i] = { ...next[i], ...row };
    return next.sort(byPos);
  });

  // ── Save plumbing ────────────────────────────────────────────────────
  const doSave = async (job) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setErr('Not signed in'); setStatus('error'); return; }
    setStatus('saving');
    const { error } = await supabase
      .from('story_pages')
      .update({ content: job.content, updated_by: user.id })
      .eq('id', job.pageId);
    if (error) { setErr(error.message); setStatus('error'); return; }
    setSavedAt(new Date());
    if (pendingRef.current && pendingRef.current.pageId === job.pageId &&
        pendingRef.current.content === job.content) {
      dirtyRef.current = false;
    }
    setStatus('idle');
  };

  const flushSave = () => {
    if (!pendingRef.current) return;
    clearTimeout(saveTimerRef.current);
    const job = pendingRef.current;
    pendingRef.current = null;
    doSave(job);
  };

  const scheduleSave = (pageId, content) => {
    pendingRef.current = { pageId, content };
    dirtyRef.current = true;
    lastEditRef.current = Date.now();
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const job = pendingRef.current;
      pendingRef.current = null;
      if (job) doSave(job);
    }, 700);
  };

  // ── Load + subscribe ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus('loading'); setErr(''); pendingRef.current = null; dirtyRef.current = false;
    (async () => {
      const { data, error } = await supabase
        .from('story_pages')
        .select('id, title, content, position, created_by, created_at, updated_at, deleted_at')
        .eq('session_id', sessionId)
        .is('deleted_at', null)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) { setErr(error.message); setStatus('error'); return; }
      const sorted = [...(data || [])].sort(byPos);
      setPages(sorted);
      setActiveId((cur) => (sorted.find((p) => p.id === cur) ? cur : (sorted[0]?.id || null)));
      setStatus('idle');
    })();

    const ch = supabase
      .channel(`story-pages-dm-${sessionId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'story_pages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const { eventType, new: row, old } = payload;
          if (eventType === 'DELETE') {
            const goneId = old?.id;
            if (!goneId) return;
            setPages((prev) => prev.filter((p) => p.id !== goneId));
            setTrashTick((t) => t + 1);
            return;
          }
          if (!row) return;
          // Soft delete: row stays in the table but should leave the active list.
          if (row.deleted_at) {
            setPages((prev) => prev.filter((p) => p.id !== row.id));
            setTrashTick((t) => t + 1);
            return;
          }
          if (row.id === activeIdRef.current) {
            const idle = !editingRef.current && Date.now() - lastEditRef.current > 1500;
            if (!idle || dirtyRef.current) {
              setPages((prev) => prev.map((p) =>
                p.id === row.id ? { ...p, title: row.title, position: row.position } : p));
              return;
            }
          }
          upsertPage(row);
        })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); flushSave(); };
  }, [sessionId]);

  useEffect(() => {
    if (activeId && !pages.find((p) => p.id === activeId)) setActiveId(pages[0]?.id || null);
  }, [pages, activeId]);

  // ── Actions ──────────────────────────────────────────────────────────
  const selectPage = (id) => {
    if (id === activeId) return;
    flushSave();
    editingRef.current = false; dirtyRef.current = false; lastEditRef.current = 0;
    setRenaming(false);
    setActiveId(id);
  };

  const onContentChange = (e) => {
    const v = e.target.value;
    setPages((prev) => prev.map((p) => (p.id === activeId ? { ...p, content: v } : p)));
    if (activeId) scheduleSave(activeId, v);
  };

  const addChapter = async () => {
    setErr('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setErr('Not signed in'); return; }
    const maxPos = pages.reduce((m, p) => Math.max(m, p.position || 0), -1);
    const { data, error } = await supabase
      .from('story_pages')
      .insert({
        session_id: sessionId, title: `Chapter ${pages.length + 1}`, content: '',
        position: maxPos + 1, created_by: user.id, updated_by: user.id,
      })
      .select('id, title, content, position, created_by, created_at, updated_at')
      .single();
    if (error) { setErr(error.message); return; }
    upsertPage(data);
    selectPage(data.id);
    setRenaming(true);
  };

  const commitRename = async (title) => {
    setRenaming(false);
    const t = (title || '').trim();
    if (!active || !t || t === active.title) return;
    upsertPage({ id: active.id, title: t });
    const { error } = await supabase.from('story_pages').update({ title: t }).eq('id', active.id);
    if (error) setErr(error.message);
  };

  const removeChapter = async () => {
    if (!active) return;
    if (!window.confirm(`Move "${active.title}" to Trash? You can restore it from the 🗑 Trash button.`)) return;
    const goneId = active.id;
    flushSave();
    setPages((prev) => prev.filter((p) => p.id !== goneId));
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('story_pages')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id || null })
      .eq('id', goneId);
    if (error) { setErr(error.message); return; }
    toast2('Moved to Trash — restore from 🗑');
  };

  const savedLabel =
    status === 'saving' ? 'Saving…' :
    status === 'error'  ? `Error: ${err}` :
    savedAt             ? `Saved ${savedAt.toLocaleTimeString()}` :
    active?.updated_at  ? `Last edit ${new Date(active.updated_at).toLocaleString()}` :
                          '';

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <Label style={{ marginBottom: 0 }}>Chronicle (shared with players)</Label>
        <span style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.12em', color: status === 'error' ? G.red : G.muted }}>
          {savedLabel}
        </span>
      </div>

      {/* Chapter tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {pages.map((p) => {
          const on = p.id === activeId;
          return (
            <button
              key={p.id}
              onClick={() => selectPage(p.id)}
              onDoubleClick={() => { if (on) setRenaming(true); }}
              style={{
                flexShrink: 0, fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.06em',
                padding: '5px 11px', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1px solid ${on ? G.gold : G.border}`,
                background: on ? `${G.gold}1e` : 'transparent',
                color: on ? G.gold : G.muted,
              }}
              title="Click to open · double-click to rename"
            >
              {p.title || 'Untitled'}
            </button>
          );
        })}
        <button
          onClick={addChapter}
          title="Add a chapter"
          style={{
            flexShrink: 0, fontFamily: 'Cinzel,serif', fontSize: 14, lineHeight: 1,
            padding: '4px 10px', borderRadius: 3, cursor: 'pointer',
            border: `1px dashed ${G.gold}66`, background: 'transparent', color: G.goldDim,
          }}
        >+</button>
        <button
          onClick={() => setShowTrash(true)}
          title="Restore deleted chapters"
          style={{
            flexShrink: 0, fontFamily: 'Cinzel,serif', fontSize: 12, lineHeight: 1,
            padding: '4px 9px', borderRadius: 3, cursor: 'pointer',
            border: `1px solid ${G.gold}33`, background: 'transparent', color: G.goldDim,
          }}
        >🗑</button>
      </div>

      {active && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {renaming ? (
            <input
              autoFocus
              defaultValue={active.title}
              onBlur={(e) => commitRename(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }}
              style={{
                flex: 1, background: G.surface, border: `1px solid ${G.gold}66`, color: G.text,
                fontFamily: 'Cinzel,serif', fontSize: 12, padding: '4px 8px', borderRadius: 2, boxSizing: 'border-box',
              }}
            />
          ) : (
            <div
              onClick={() => setRenaming(true)}
              style={{ flex: 1, fontFamily: 'Cinzel,serif', fontSize: 12, color: G.gold, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title="Click to rename"
            >
              {active.title || 'Untitled'} <span style={{ color: G.muted, fontSize: 10 }}>✎</span>
            </div>
          )}
          {!renaming && (
            <button
              onClick={removeChapter}
              style={{
                flexShrink: 0, fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.12em',
                border: `1px solid ${G.red}88`, borderRadius: 3, background: 'transparent',
                color: G.red, padding: '5px 9px', cursor: 'pointer',
              }}
            >✕ DELETE</button>
          )}
        </div>
      )}

      {active ? (
        <textarea
          key={active.id}
          value={active.content || ''}
          onChange={onContentChange}
          onFocus={() => { editingRef.current = true; }}
          onBlur={()  => { editingRef.current = false; }}
          placeholder="Write the unfolding tale…"
          rows={14}
          style={{
            width: '100%', boxSizing: 'border-box', background: G.surface, border: `1px solid ${G.border}`,
            color: G.text, fontFamily: 'EB Garamond,serif', fontSize: 14, lineHeight: 1.7,
            padding: '10px 12px', borderRadius: 3, resize: 'vertical', outline: 'none',
          }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0', textAlign: 'center' }}>
          <div style={{ color: G.muted, fontStyle: 'italic', fontSize: 13 }}>No chapters yet.</div>
          <button
            onClick={addChapter}
            style={{
              fontFamily: 'Cinzel,serif', fontSize: 11, letterSpacing: '.15em',
              border: `1px solid ${G.gold}`, borderRadius: 3, background: 'transparent',
              color: G.gold, padding: '9px 16px', cursor: 'pointer',
            }}
          >+ ADD CHAPTER</button>
        </div>
      )}
      {showTrash && (
        <TrashedChaptersModal
          key={trashTick}
          sessionId={sessionId}
          onClose={() => setShowTrash(false)}
          onMsg={toast2}
        />
      )}
      <Toast msg={toast} />
    </Card>
  );
}
