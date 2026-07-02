/** Row shape of public.profiles (see supabase/migrations/0001_initial_schema.sql). */
export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}
