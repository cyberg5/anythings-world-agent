import { createHash } from "crypto";
import { db } from "./supabase.js";

/**
 * Persists OAuth tokens that change between runs, in the Supabase
 * `platform_tokens` table (RLS on, no anon policy — only the pipeline's
 * service_role key can read it; never the app's anon key).
 *
 * Why not just GitHub secrets: TikTok ROTATES its refresh token on every
 * refresh and immediately invalidates the old one, so a static secret would
 * work exactly once. Instagram's long-lived token is refreshed every few
 * days for the same reason (60-day expiry).
 *
 * The GitHub secret acts as a SEED. We store a hash of the seed next to the
 * live token: if the secret changes (operator re-authorized and pasted a new
 * one), the hash no longer matches and the new seed wins over the stale
 * stored token — so re-auth never requires touching the database by hand.
 */

export interface StoredToken {
  value: string;
  updatedAt: Date;
}

function hashSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/** Returns the live token for `key`, or null if none stored / the seed secret changed since. */
export async function loadToken(key: string, seed: string): Promise<StoredToken | null> {
  const { data, error } = await db
    .from("platform_tokens")
    .select("value, seed_hash, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Could not read platform_tokens (did you run supabase/multi_platform.sql?): ${error.message}`);
  if (!data || data.seed_hash !== hashSeed(seed)) return null;
  return { value: data.value, updatedAt: new Date(data.updated_at) };
}

export async function saveToken(key: string, seed: string, value: string): Promise<void> {
  const { error } = await db.from("platform_tokens").upsert({
    key,
    value,
    seed_hash: hashSeed(seed),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not save ${key} to platform_tokens: ${error.message}`);
}
