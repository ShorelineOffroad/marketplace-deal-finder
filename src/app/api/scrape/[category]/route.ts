import type { NextRequest } from "next/server";
import { scrapeFacebookMarketplace } from "@/lib/apify";
import { getSupabaseAdmin } from "@/lib/supabase";
import { computeComparableScores, FLAG_PERCENTILE_THRESHOLD } from "@/lib/valuation";
import { evaluateListing } from "@/lib/haiku";

// A single Apify scrape call has taken anywhere from ~12s to ~40s in testing (Apify-side
// variance, not something we control) — 60s leaves comfortable margin for one category.
export const maxDuration = 60;

// One route invocation per category (see vercel.json — each has its own staggered cron
// schedule). Earlier this was one route looping over all 3 categories, but Apify throttles
// concurrent synchronous runs from the same account, so "parallel" calls just queued behind
// each other — 3 categories in one invocation took 52s, most of it serialized scrape time.
// Splitting into separate invocations sidesteps that entirely, and each one only needs
// ~20-40s instead of racing 3x that inside a single 60s budget.
const SEARCHES: Record<string, { query: string }> = {
  power_tools: { query: "power tools" },
  furniture: { query: "furniture" },
  ski_snowboard: { query: "ski snowboard" },
};

const RESULTS_PER_SEARCH = 20;

// Safety valve: caps how many Haiku calls run per invocation, protecting against
// runaway duration/cost if a lot of listings suddenly clear the comparable filter.
const MAX_LLM_EVALUATIONS_PER_RUN = 20;

// Shape returned when includeListingDetails is true — entirely different field names
// from the plain search-results mode (e.g. listingTitle vs. marketplace_listing_title).
interface ApifyListingItem {
  id?: string;
  itemUrl?: string;
  listingTitle?: string;
  listingPrice?: { amount?: string; currency?: string };
  description?: { text?: string };
  condition?: string;
  isSold?: boolean;
  primaryListingPhoto?: { photo_image_url?: string };
  locationText?: { text?: string };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { category } = await params;
  const search = SEARCHES[category];
  if (!search) {
    return new Response(`Unknown category: ${category}`, { status: 404 });
  }

  const supabase = getSupabaseAdmin();

  const items: ApifyListingItem[] = await scrapeFacebookMarketplace(
    search.query,
    RESULTS_PER_SEARCH
  );

  const rows = items
    .filter((item) => item.id && item.listingTitle && item.listingPrice?.amount)
    .map((item) => {
      // locationText is a single "City, Region" string in this response mode.
      const [locationCity, locationState] = (item.locationText?.text ?? "")
        .split(",")
        .map((part) => part.trim());

      return {
        external_id: item.id!,
        category,
        title: item.listingTitle!,
        description: item.description?.text ?? null,
        condition: item.condition ?? null,
        is_sold: item.isSold ?? false,
        price: parseFloat(item.listingPrice!.amount!),
        currency: item.listingPrice!.currency ?? "CAD",
        url: item.itemUrl ?? `https://www.facebook.com/marketplace/item/${item.id}`,
        image_url: item.primaryListingPhoto?.photo_image_url ?? null,
        location_city: locationCity || null,
        location_state: locationState || null,
        last_seen_at: new Date().toISOString(),
      };
    });

  if (rows.length > 0) {
    const { error } = await supabase
      .from("listings")
      .upsert(rows, { onConflict: "external_id" });
    if (error) throw error;
  }

  // Re-score every stored listing in this category, not just this batch — as more
  // comparables accumulate over time, past listings can newly clear (or fall out of)
  // the group-size threshold. Cheap at our current volume (tens of rows/category).
  const { data: allListings, error: fetchError } = await supabase
    .from("listings")
    .select("id, category, title, price")
    .eq("category", category);
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
      .select("id, title, description, condition, price, currency, category")
      .in("id", candidateIds)
      .is("llm_estimated_value", null)
      .eq("is_sold", false)
      .limit(MAX_LLM_EVALUATIONS_PER_RUN);
    if (candidatesError) throw candidatesError;

    // Independent per-listing calls — run concurrently rather than one-at-a-time.
    await Promise.all(
      (candidates ?? []).map(async (listing) => {
        if (listing.price == null) return;

        const result = await evaluateListing({
          title: listing.title,
          description: listing.description,
          condition: listing.condition,
          price: listing.price,
          currency: listing.currency,
          category: listing.category,
        });
        if (!result) return;

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
      })
    );
  }

  return Response.json({
    ok: true,
    category,
    scraped: rows.length,
    scored: scores.size,
    evaluated,
    flagged,
  });
}
