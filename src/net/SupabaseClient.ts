import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NET } from '../config/Constants';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;
let initError: string | null = null;

/**
 * True when both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are present.
 * Without them the game still boots - it simply falls back to offline
 * PRACTICE mode and tells the player what to configure.
 */
export function isSupabaseConfigured(): boolean {
  return url.startsWith('http') && anonKey.length > 20;
}

export function supabaseConfigError(): string | null {
  if (!isSupabaseConfigured()) {
    return 'SUPABASE NOT CONFIGURED - SET VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY';
  }
  return initError;
}

/** Lazily created singleton Supabase client (Realtime only - no database writes). */
export function getSupabase(): SupabaseClient | null {
  if (client || !isSupabaseConfigured()) return client;

  try {
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: NET.eventsPerSecond } }
    });
  } catch (err) {
    initError = `SUPABASE INIT FAILED: ${(err as Error).message}`;
    console.error(initError, err);
    client = null;
  }

  return client;
}
