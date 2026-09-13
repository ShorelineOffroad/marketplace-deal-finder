// Known power tool brands, used to group listings into meaningful comparables.
// Grouping by category alone is too coarse — a $160 Milwaukee tool and a $1 "tools nail
// guns etc" listing aren't comparable items even though they're both "power_tools".
const KNOWN_BRANDS = [
  "milwaukee", "dewalt", "makita", "bauer", "ryobi", "bosch", "craftsman",
  "ridgid", "ego", "kobalt", "hart", "black+decker", "black & decker",
  "metabo", "skil", "porter-cable", "ozito", "festool",
];

export function detectBrand(title: string): string | null {
  const lower = title.toLowerCase();
  return KNOWN_BRANDS.find((brand) => lower.includes(brand)) ?? null;
}

// Below this, a group's price spread is too noisy to compare against meaningfully.
const MIN_GROUP_SIZE = 5;

// Bottom 20% of a group's prices clears the free filter, becoming eligible for the
// Claude Haiku second-opinion pass (a later build step).
export const FLAG_PERCENTILE_THRESHOLD = 0.2;

export interface ScorableListing {
  id: number;
  category: string;
  title: string;
  price: number | null;
}

// Returns a percentile rank (0 = cheapest, 1 = priciest) per listing id, for listings
// whose brand/category group has enough comparables to be meaningful. Listings in
// undersized groups are omitted entirely (undetermined, not flagged).
export function computeComparableScores(
  listings: ScorableListing[]
): Map<number, number> {
  const groups = new Map<string, ScorableListing[]>();
  for (const listing of listings) {
    if (listing.price == null) continue;
    const brand = detectBrand(listing.title) ?? "unbranded";
    const groupKey = `${listing.category}::${brand}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(listing);
  }

  const scores = new Map<number, number>();
  for (const group of groups.values()) {
    if (group.length < MIN_GROUP_SIZE) continue;

    const sorted = [...group].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    sorted.forEach((listing, i) => {
      scores.set(listing.id, i / (sorted.length - 1));
    });
  }

  return scores;
}
