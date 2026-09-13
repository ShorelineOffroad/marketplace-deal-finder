import type { NextRequest } from "next/server";
import { scrapeFacebookMarketplace } from "@/lib/apify";
import { getSupabaseAdmin } from "@/lib/supabase";

// Apify's scrape call can take a while; default Vercel function timeout is too short.
export const maxDuration = 60;

// One entry per category. Deferred categories (exercise equipment, ski/snowboard gear)
// get added here once real cost data from this narrower scope justifies expanding —
// see the Build plan in the project's scoping doc.
const SEARCHES = [{ category: "power_tools", query: "power tools" }];

const RESULTS_PER_SEARCH = 30;

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

  return Response.json({ ok: true, scraped });
}
