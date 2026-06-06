import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Card, Label } from './SharedUI.jsx';

// Shared, collaborative story log for a session. Last-write-wins.
// The textarea debounces saves; postgres_changes pushes remote edits in
// when the editor isn't actively being typed into.
export default function StoryLogPanel({ sessionId }) {
  const G = useTheme();
  const [content,  setContent]  = useState('');
  const [remoteTs, setRemoteTs] = useState(null);
  const [savedAt,  setSavedAt]  = useState(null);
  const [status,   setStatus]   = useState('idle'); // idle | loading | saving | error
  const [err,      setErr]      = useState('');

  const editingRef       = useRef(false);
  const localDirtyRef    = useRef(false);
  const lastLocalEditRef = useRef(0);
  const saveTimerRef     = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading'); setErr('');
    (async () => {
      const { data, error } = await supabase
        .from('story_log')
        .select('content, updated_at')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (cancelled) return;
      if (error) { setErr(error.message); setStatus('error'); return; }
      setContent(data?.content || '');
      setRemoteTs(data?.updated_at || null);
      localDirtyRef.current = false;
      setStatus('idle');
    })();

    const ch = supabase
      .channel(`story-log-dm-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'story_log', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.content == null) return;
          if (remoteTs && row.updated_at && row.updated_at <= remoteTs) return;
          const idle = !editingRef.current && Date.now() - lastLocalEditRef.current > 1500;
          if (idle && !localDirtyRef.current) setContent(row.content);
          setRemoteTs(row.updated_at || null);
        },
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [sessionId]);

  const scheduleSave = (next) => {
    localDirtyRef.current = true;
    lastLocalEditRef.current = Date.now();
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErr('Not signed in'); setStatus('error'); return; }
      setStatus('saving');
      const { error } = await supabase
        .from('story_log')
        .upsert(
          { session_id: sessionId, content: next, updated_by: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'session_id' },
        );
      if (error) { setErr(error.message); setStatus('error'); return; }
      setSavedAt(new Date());
      localDirtyRef.current = false;
      setStatus('idle');
    }, 700);
  };

  const onChange = (e) => {
    setContent(e.target.value);
    scheduleSave(e.target.value);
  };

  const savedLabel =
    status === 'saving' ? 'Saving…' :
    status === 'error'  ? `Error: ${err}` :
    savedAt             ? `Saved ${savedAt.toLocaleTimeString()}` :
    remoteTs            ? `Last edit ${new Date(remoteTs).toLocaleString()}` :
                          '';

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <Label style={{ marginBottom: 0 }}>Chronicle log (shared with players)</Label>
        <span style={{
          fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.12em',
          color: status === 'error' ? G.red : G.muted,
        }}>{savedLabel}</span>
      </div>
      <textarea
        value={content}
        onChange={onChange}
        onFocus={() => { editingRef.current = true; }}
        onBlur={()  => { editingRef.current = false; }}
        placeholder="Write the unfolding tale…"
        rows={14}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: G.surface, border: `1px solid ${G.border}`,
          color: G.text, fontFamily: 'EB Garamond,serif', fontSize: 14,
          lineHeight: 1.7, padding: '10px 12px', borderRadius: 3,
          resize: 'vertical', outline: 'none',
        }}
      />
    </Card>
  );
}
