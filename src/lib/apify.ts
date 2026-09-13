// Facebook's Marketplace URLs need its internal numeric location ID for smaller cities —
// name slugs like "kelowna" silently resolve to the wrong city instead of erroring.
// Found via web search; Kelowna, BC's ID is 111949595490847.
const KELOWNA_LOCATION_ID = "111949595490847";

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
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
