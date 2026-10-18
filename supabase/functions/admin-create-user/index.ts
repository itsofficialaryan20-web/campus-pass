// Supabase Edge Function (Deno). Creates a user ON THE SERVER because it needs the service-role key,
// which must never reach the browser. Deploy:  supabase functions deploy admin-create-user
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const ROLES = ['student', 'program_manager', 'swo', 'security', 'admin'];

function tempPassword(): string {
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, 'x') + '!9';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    // 1) Who is calling? Use THEIR token, then check they are an ACTIVE admin in the database.
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);
    const { data: me } = await caller.from('profiles').select('role,status').eq('id', user.id).single();
    if (!me || me.role !== 'admin' || me.status !== 'ACTIVE') return json({ error: 'Admins only' }, 403);

    // 2) Validate input.
    const b = await req.json();
    const email = String(b.email ?? '').trim().toLowerCase(); const full_name = String(b.full_name ?? '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!full_name || full_name.length > 120) return json({ error: 'Enter a full name (max 120 characters).' }, 400);
    if (!ROLES.includes(b.role)) return json({ error: 'Invalid role.' }, 400);

    // 3) Create the auth user with the service role. The database trigger makes a PENDING student profile.
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const password = tempPassword();
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
    if (error || !created.user) return json({ error: error?.message ?? 'Could not create the user.' }, 400);

    // 4) Activate and assign using the CALLER's session so the audit log records which admin did it.
    const { error: e2 } = await caller.rpc('admin_update_profile', {
      p_user: created.user.id, p_full_name: full_name, p_role: b.role, p_status: 'ACTIVE',
      p_department: b.department ?? '', p_college_id: b.college_id ?? '',
      p_manager_id: b.role === 'student' ? (b.assigned_manager_id ?? null) : null,
    });
    if (e2) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: e2.message }, 400); }

    const { data: profile } = await admin.from('profiles').select('*').eq('id', created.user.id).single();
    return json({ profile: { ...profile, email }, temporaryPassword: password });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
