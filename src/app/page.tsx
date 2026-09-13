import { getSupabaseAdmin } from "@/lib/supabase";

// Without this, Next.js would statically prerender this page at build time and
// serve stale data forever — the scrape runs daily via cron, so this page needs
// to query Supabase fresh on every visit instead.
export const dynamic = "force-dynamic";

interface FlaggedListing {
  id: number;
  title: string;
  price: number;
  currency: string;
  category: string;
  url: string;
  image_url: string | null;
  location_city: string | null;
  llm_estimated_value: number;
  llm_reasoning: string;
  flagged_at: string;
}

async function getFlaggedDeals(): Promise<FlaggedListing[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("listings")
    .select(
      "id, title, price, currency, category, url, image_url, location_city, llm_estimated_value, llm_reasoning, flagged_at"
    )
    .eq("is_flagged", true)
    .order("flagged_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

function discountPercent(price: number, estimatedValue: number): number {
  return Math.round(((estimatedValue - price) / estimatedValue) * 100);
}

export default async function Home() {
  const deals = await getFlaggedDeals();
  const sorted = [...deals].sort(
    (a, b) =>
      discountPercent(b.price, b.llm_estimated_value) -
      discountPercent(a.price, a.llm_estimated_value)
  );

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 dark:bg-black sm:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Marketplace Deal Finder
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {sorted.length} flagged deal{sorted.length === 1 ? "" : "s"} · power tools · Kelowna
        </p>

        {sorted.length === 0 ? (
          <p className="mt-10 text-zinc-500 dark:text-zinc-400">
            No deals flagged yet. Check back after the next scheduled scrape.
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-4">
            {sorted.map((deal) => (
              <li
                key={deal.id}
                className="flex gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                {deal.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={deal.image_url}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-md object-cover"
                  />
                )}
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {deal.title}
                    </span>
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-400">
                      {discountPercent(deal.price, deal.llm_estimated_value)}% under
                    </span>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Asking <strong>${deal.price}</strong> {deal.currency} · est. value{" "}
                    <strong>${deal.llm_estimated_value}</strong>
                    {deal.location_city ? ` · ${deal.location_city}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
                    {deal.llm_reasoning}
                  </p>
                  <a
                    href={deal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex w-fit items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Open in Facebook →
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
