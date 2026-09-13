// Facebook's Marketplace URLs need its internal numeric location ID for smaller cities —
// name slugs like "kelowna" silently resolve to the wrong city instead of erroring.
// Found via web search; Kelowna, BC's ID is 111949595490847.
const KELOWNA_LOCATION_ID = "111949595490847";

// includeListingDetails fetches each listing's full detail page (description, condition,
// sold status) instead of just search-result summary fields. No separate pricing tier for
// this per Apify's docs — same $5/1,000 either way — but it changes the response schema
// entirely (different field names/shapes) and takes longer per item (~1.2s/item observed).
export async function scrapeFacebookMarketplace(
  searchQuery: string,
  resultsLimit: number
) {
  const url = `https://www.facebook.com/marketplace/${KELOWNA_LOCATION_ID}/search/?query=${encodeURIComponent(searchQuery)}`;

  const res = await fetch(
    "https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/run-sync-get-dataset-items",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startUrls: [{ url }],
        resultsLimit,
        includeListingDetails: true,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
