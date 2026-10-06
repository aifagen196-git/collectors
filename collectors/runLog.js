// Writes one row to public.collector_runs per collector run, for the admin
// portal's "Collector run history" panel. Best-effort only — a logging
// failure must never take down the actual scrape/save run, so every
// function here swallows its own errors after a console.error.
//
// Deliberately self-contained (own dotenv + supabase client, not importing
// getSupabase from runtime.js) — runtime.js's runCollector() calls into this
// file, so importing runtime.js back here would be a circular import.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const collectorsDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(collectorsDir, "../.env"), quiet: true });

let supabase;
function client() {
  if (supabase) return supabase;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return supabase;
}

async function countSavedSince(db, source, since) {
  try {
    const iso = since.toISOString();
    const count = async (column) => {
      const { count: n, error } = await db
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("source", source)
        .gte(column, iso);
      if (error) throw error;
      return n ?? 0;
    };
    return { saved: await count("last_seen"), created: await count("created_at") };
  } catch (err) {
    console.error(`⚠ collector_runs: couldn't count saved jobs for ${source}: ${err.message}`);
    return null;
  }
}

/**
 * Wraps a collector's main function with start/end run logging.
 *
 * @param {string} source - matches the `source` column used elsewhere for
 *   this collector's jobs (e.g. "greenhouse", "linkedin").
 * @param {() => Promise<{ saved?: number, failed?: number } | void>} fn -
 *   the collector's actual run function. If it returns an object with
 *   `saved`/`failed` counts, those are logged too; otherwise just
 *   success/failure and duration are recorded.
 */
export async function withRunLog(source, fn) {
  const startedAt = new Date();
  let runId = null;
  const db = client();

  if (db) {
    try {
      const { data, error } = await db
        .from("collector_runs")
        .insert({ source, started_at: startedAt.toISOString() })
        .select("id")
        .single();
      if (error) throw error;
      runId = data.id;
    } catch (err) {
      console.error(`⚠ collector_runs: failed to log run start for ${source}: ${err.message}`);
    }
  }

  let result;
  let caught = null;
  try {
    result = await fn();
  } catch (err) {
    caught = err;
  }

  if (runId) {
    // Most collectors don't return counts, which left "saved" empty and made
    // a run that saved nothing look identical to a healthy one. Every save
    // stamps last_seen (and new rows get created_at), so count from the jobs
    // table instead: what this source touched since the run started.
    const counts = await countSavedSince(db, source, startedAt);
    const row = {
      finished_at: new Date().toISOString(),
      success: !caught,
      saved:
        result && typeof result.saved === "number" ? result.saved : counts ? counts.saved : null,
      failed: result && typeof result.failed === "number" ? result.failed : null,
      // A collector that can't run (e.g. its API key isn't set) returns
      // { skipped: "<reason>" }; record why, so the admin page can show
      // "Skipped" instead of a success that saved nothing.
      error: caught
        ? String(caught.message || caught).slice(0, 2000)
        : typeof result?.skipped === "string"
          ? `Skipped: ${result.skipped}`
          : null,
    };
    // Browser-based collectors (Indeed, SimplyHired) count searches that hit
    // a bot-check page. If that's why nothing was saved, say so.
    if (!row.error && result?.blocked > 0 && !row.saved) {
      row.error = `Blocked by the site's bot protection (${result.blocked} searches)`;
    }
    try {
      let { error } = await db
        .from("collector_runs")
        .update({ ...row, new_jobs: counts ? counts.created : null })
        .eq("id", runId);
      // new_jobs arrives with main-repo migration 0023; until it's applied,
      // log everything else.
      if (error && /new_jobs/.test(error.message)) {
        ({ error } = await db.from("collector_runs").update(row).eq("id", runId));
      }
      if (error) throw error;
    } catch (err) {
      console.error(`⚠ collector_runs: failed to log run end for ${source}: ${err.message}`);
    }
  }

  if (caught) throw caught;
  return result;
}
