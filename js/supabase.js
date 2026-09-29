// Supabase-klienten. Versionen är låst så att service workern kan cacha modulen.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const isConfigured =
  /^https:\/\/[^/]+/.test(SUPABASE_URL) &&
  !SUPABASE_URL.includes('DITT-PROJEKT') &&
  !!SUPABASE_KEY && !SUPABASE_KEY.startsWith('DIN-');

// Skydd mot att en hemlig nyckel råkar hamna i klientkoden.
export const hasSecretKey =
  SUPABASE_KEY.startsWith('sb_secret_') || jwtRole(SUPABASE_KEY) === 'service_role';

function jwtRole(key) {
  try {
    const payload = key.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role || null;
  } catch {
    return null;
  }
}

export const sb = isConfigured && !hasSecretKey
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hemmet-auth' },
    })
  : null;
