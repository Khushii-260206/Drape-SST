import { streamChatAny, type LlmMessage } from "./llm";
import { profileForPrompt } from "./profile";
import { summarize } from "./prompt";
import type { ProviderKey } from "./router";
import type { ClothingItem, Profile } from "./types";

/** Cleans a model's reply into a plain paragraph: no markdown, no quotes, no preamble. */
function cleanPersona(text: string): string {
  return text
    .replace(/\[\[[^\]\n]*\]\]/g, "")
    .replace(/^\s*(here(?:'s| is)[^:\n]*:|sure[^:\n]*:)\s*/i, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*["“]+|["”]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(.{0,700}[.!?])\s.*$/, (whole, head: string) => (whole.length > 700 ? head : whole))
    .slice(0, 700);
}

/**
 * Writes a short "style persona" — who this person is as a dresser — from their profile and wardrobe,
 * so every later chat starts with a sharper sense of them. Rolls across providers like the chat does.
 */
export async function generatePersona(
  profile: Profile,
  items: ClothingItem[],
  keys: ProviderKey[],
  signal?: AbortSignal
): Promise<string> {
  const about = profileForPrompt({ ...profile, persona: "" });
  if (!about && items.length === 0) throw new Error("Fill in a few details (or add some clothes) first so there's something to work from.");

  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "You are a fashion stylist writing a style persona for your client. Write 3 or 4 sentences (at most 90 words in total) in the second person (\"You are…\"): " +
        "their overall aesthetic, the palette that suits them and the one they already lean on, the fits and silhouettes that flatter them, " +
        "and one thing worth adding or avoiding. Be specific, warm and confident. Ground every claim in the profile and wardrobe summary given — " +
        "never invent details, never comment negatively on their body. Plain prose only: no lists, headings, markdown or quotation marks.",
    },
    {
      role: "user",
      content: `ABOUT ME\n${about || "(not filled in yet)"}\n\nMY WARDROBE\n${items.length ? summarize(items) : "(empty so far)"}`,
    },
  ];

  let out = "";
  for await (const event of streamChatAny(keys, messages, signal)) if (event.type === "content") out += event.text;
  const persona = cleanPersona(out);
  if (!persona) throw new Error("The model sent back an empty persona. Try again.");
  return persona;
}
