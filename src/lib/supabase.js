import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars.');
}

export const supabase = createClient(url || 'http://invalid', key || 'invalid', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// Ensure a public.profiles row exists for the signed-in user. Idempotent.
export async function ensureProfile(handle) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, handle: handle || user.email?.split('@')[0] || 'mage' }, { onConflict: 'id' });
  if (error) throw error;
  return user;
}
