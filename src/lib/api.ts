import { createDemoApi } from './demoApi';
import { createSupabaseApi } from './supabaseApi';
import type { Api } from './apiTypes';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Real backend when both variables are set; otherwise the clearly-labelled in-browser demo. */
export const api: Api = url && key
  ? createSupabaseApi(url, key)
  : createDemoApi(typeof window !== 'undefined' ? window.localStorage : null);
export const isDemo = api.mode === 'demo';
