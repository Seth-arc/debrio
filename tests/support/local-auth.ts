import { randomUUID } from "node:crypto";
import { LOCAL_MAIL_URL } from "../../scripts/local-supabase";

export const syntheticEmail = () => `host-${randomUUID()}@example.test`;
export const SYNTHETIC_PASSWORD = "correct horse battery 42";

// Reads the confirmation link Auth sent to the local mail catcher.
export async function confirmationLink(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let attempt = 0; attempt < 50; attempt++) {
    const search = await fetch(
      `${LOCAL_MAIL_URL}/api/v1/search?query=${query}`
    );
    const { messages } = (await search.json()) as {
      messages: { ID: string }[];
    };
    if (messages.length > 0) {
      const message = await fetch(
        `${LOCAL_MAIL_URL}/api/v1/message/${messages[0].ID}`
      );
      const { Text } = (await message.json()) as { Text: string };
      const link = Text.match(/https?:\/\/\S+\/verify\?\S+?(?=[\s)\]]|$)/)?.[0];
      if (link) return link;
      throw new Error("Confirmation email has no verify link");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email for ${email}`);
}
