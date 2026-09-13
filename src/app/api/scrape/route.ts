import type { NextRequest } from "next/server";
import { scrapeFacebookMarketplace } from "@/lib/apify";
import { getSupabaseAdmin } from "@/lib/supabase";
import { computeComparableScores, FLAG_PERCENTILE_THRESHOLD } from "@/lib/valuation";
import { evaluateListing } from "@/lib/haiku";

// Apify's scrape call can take a while; default Vercel function timeout is too short.
export const maxDuration = 60;

// One entry per category. Deferred categories (exercise equipment, ski/snowboard gear)
// get added here once real cost data from this narrower scope justifies expanding —
// see the Build plan in the project's scoping doc.
const SEARCHES = [{ category: "power_tools", query: "power tools" }];

const RESULTS_PER_SEARCH = 30;

// Safety valve: caps how many Haiku calls run per invocation, protecting against
// runaway duration/cost if a lot of listings suddenly clear the comparable filter.
const MAX_LLM_EVALUATIONS_PER_RUN = 20;

interface ApifyListingItem {
  id?: string;
  listingUrl?: string;
  marketplace_listing_title?: string;
  listing_price?: { amount?: string };
  primary_listing_photo?: { photo_image_url?: string };
  location?: { reverse_geocode?: { city?: string; state?: string } };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const scraped: Record<string, number> = {};

  for (const { category, query } of SEARCHES) {
    const items: ApifyListingItem[] = await scrapeFacebookMarketplace(
      query,
      RESULTS_PER_SEARCH
    );

    const rows = items
      .filter((item) => item.id && item.marketplace_listing_title && item.listing_price?.amount)
      .map((item) => ({
        external_id: item.id!,
        category,
        title: item.marketplace_listing_title!,
        price: parseFloat(item.listing_price!.amount!),
        currency: "CAD",
        url: item.listingUrl ?? `https://www.facebook.com/marketplace/item/${item.id}`,
        image_url: item.primary_listing_photo?.photo_image_url ?? null,
        location_city: item.location?.reverse_geocode?.city ?? null,
        location_state: item.location?.reverse_geocode?.state ?? null,
        last_seen_at: new Date().toISOString(),
      }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("listings")
        .upsert(rows, { onConflict: "external_id" });
      if (error) throw error;
    }

    scraped[category] = rows.length;
  }

  // Re-score every stored listing in the touched categories, not just this batch —
  // as more comparables accumulate over time, past listings can newly clear (or fall
  // out of) the group-size threshold. Cheap at our current volume (tens of rows/category).
  const categories = SEARCHES.map((s) => s.category);
  const { data: allListings, error: fetchError } = await supabase
    .from("listings")
    .select("id, category, title, price")
    .in("category", categories);
  if (fetchError) throw fetchError;

  const scores = computeComparableScores(allListings ?? []);
  await Promise.all(
    Array.from(scores.entries()).map(([id, comparable_score]) =>
      supabase.from("listings").update({ comparable_score }).eq("id", id)
    )
  );

  // Send listings that clear the free comparable filter (and haven't been evaluated
  // before) to Claude Haiku for a real value estimate. Capped per run as a safety valve.
  const candidateIds = Array.from(scores.entries())
    .filter(([, score]) => score <= FLAG_PERCENTILE_THRESHOLD)
    .map(([id]) => id);

  let evaluated = 0;
  let flagged = 0;

  if (candidateIds.length > 0) {
    const { data: candidates, error: candidatesError } = await supabase
      .from("listings")
      .select("id, title, price, currency, category")
      .in("id", candidateIds)
      .is("llm_estimated_value", null)
      .limit(MAX_LLM_EVALUATIONS_PER_RUN);
    if (candidatesError) throw candidatesError;

    for (const listing of candidates ?? []) {
      if (listing.price == null) continue;

      const result = await evaluateListing({
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        category: listing.category,
      });
      if (!result) continue;

      const { error: updateError } = await supabase
        .from("listings")
        .update({
          llm_estimated_value: result.estimated_value,
          llm_reasoning: result.reasoning,
          is_flagged: result.is_good_deal,
          flagged_at: result.is_good_deal ? new Date().toISOString() : null,
        })
        .eq("id", listing.id);
      if (updateError) throw updateError;

      evaluated++;
      if (result.is_good_deal) flagged++;
    }
  }

  return Response.json({ ok: true, scraped, scored: scores.size, evaluated, flagged });
}
