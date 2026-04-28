import { pool } from "../../config/db.js";

export type TrendSpike = {
  category: string;
  current_count: number;
  baseline_mean: number;
  spike_ratio: number;
  window_start: string;
  window_end: string;
};

export async function computeTrends(): Promise<TrendSpike[]> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 60 * 60 * 1000);

  // Current hour counts by category
  const currentRes = await pool.query<{ category: string | null; current_count: string }>(
    `SELECT COALESCE(category, 'Uncategorized') AS category,
            COUNT(*)::text AS current_count
     FROM tickets
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY COALESCE(category, 'Uncategorized')`,
    [windowStart.toISOString(), windowEnd.toISOString()]
  );

  // Baseline: average hourly volume over last 24h per category
  const baselineRes = await pool.query<{ category: string; total_24h: string }>(
    `SELECT COALESCE(category, 'Uncategorized') AS category,
            COUNT(*)::text AS total_24h
     FROM tickets
     WHERE created_at >= now() - interval '24 hours'
     GROUP BY COALESCE(category, 'Uncategorized')`
  );

  const baselineMap = new Map<string, number>();
  for (const r of baselineRes.rows) {
    baselineMap.set(r.category, Number(r.total_24h) / 24);
  }

  const spikes: TrendSpike[] = [];

  for (const r of currentRes.rows) {
    const category = r.category ?? "Uncategorized";
    const currentCount = Number(r.current_count);
    const baselineMean = baselineMap.get(category) ?? 0;
    const spikeRatio = baselineMean > 0 ? currentCount / baselineMean : currentCount > 0 ? 999 : 0;

    // Simple heuristic: ignore tiny counts; flag if >= 5 and >= 3x baseline
    const isSpike = currentCount >= 5 && (baselineMean === 0 ? currentCount >= 10 : spikeRatio >= 3);
    if (!isSpike) continue;

    spikes.push({
      category,
      current_count: currentCount,
      baseline_mean: Number(baselineMean.toFixed(2)),
      spike_ratio: Number(spikeRatio.toFixed(2)),
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
    });
  }

  // Persist spikes for dashboard/history
  for (const s of spikes) {
    await pool.query(
      `INSERT INTO incident_trends
       (category, window_start, window_end, current_count, baseline_mean, spike_ratio)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.category, s.window_start, s.window_end, s.current_count, s.baseline_mean, s.spike_ratio]
    );
  }

  return spikes;
}

export async function getLatestTrends(): Promise<TrendSpike[]> {
  const res = await pool.query<TrendSpike>(
    `SELECT category, current_count, baseline_mean, spike_ratio, window_start, window_end
     FROM incident_trends
     WHERE created_at > now() - interval '24 hours'
     ORDER BY created_at DESC
     LIMIT 10`
  );
  return res.rows;
}

