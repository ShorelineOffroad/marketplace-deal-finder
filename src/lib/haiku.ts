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
  price: number;
  currency: string;
  category: string;
}): Promise<ValuationResult | null> {
  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system:
      "You are a secondhand resale expert judging Facebook Marketplace listings. " +
      "Given a listing's category, title, and asking price, estimate its fair used " +
      "resale value and judge whether the asking price is a genuinely good deal " +
      "(priced meaningfully below fair value). Be skeptical of listings that aren't " +
      "actually usable items in this category (toys, accessories, unrelated items, " +
      "yard sale grab-bags) — mark those as not a good deal regardless of price.",
    messages: [
      {
        role: "user",
        content: `Category: ${params.category}\nTitle: ${params.title}\nAsking price: ${params.price} ${params.currency}`,
      },
    ],
    output_config: {
      format: zodOutputFormat(ValuationSchema),
    },
  });

  return response.parsed_output;
}
