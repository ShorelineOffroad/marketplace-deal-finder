import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();

const ValuationSchema = z.object({
  estimated_value: z.number(),
  is_good_deal: z.boolean(),
  reasoning: z.string(),
});

export interface ValuationResult {
  estimated_value: number;
  is_good_deal: boolean;
  reasoning: string;
}

export async function evaluateListing(params: {
  title: string;
  description?: string | null;
  condition?: string | null;
  price: number;
  currency: string;
  category: string;
}): Promise<ValuationResult | null> {
  const lines = [
    `Category: ${params.category}`,
    `Title: ${params.title}`,
    params.condition ? `Condition: ${params.condition}` : null,
    params.description ? `Description: ${params.description}` : null,
    `Asking price: ${params.price} ${params.currency}`,
  ].filter(Boolean);

  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system:
      "You are a secondhand resale expert judging Facebook Marketplace listings. " +
      "Given a listing's category, title, description, condition, and asking price, " +
      "estimate its fair used resale value and judge whether the asking price is a " +
      "genuinely good deal (priced meaningfully below fair value). Be skeptical of " +
      "listings that aren't actually usable items in this category (toys, accessories, " +
      "unrelated items, yard sale grab-bags) — mark those as not a good deal regardless " +
      "of price. When no description is given, be more conservative, since there's less " +
      "to verify what's actually included. Asking prices of $0-$5 are usually a " +
      "placeholder or negotiation-starter, not the real transactable price (a common " +
      "Marketplace pattern for bulk lots or 'make an offer' listings) — do not treat " +
      "them as a literal 90%+ discount off your estimate; mark these as not a good deal " +
      "unless the description explicitly confirms that price is genuinely final.",
    messages: [{ role: "user", content: lines.join("\n") }],
    output_config: {
      format: zodOutputFormat(ValuationSchema),
    },
  });

  return response.parsed_output;
}
