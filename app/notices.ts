// Status messages chosen by allow-listed query values; unknown values show nothing.

// Where an email-change link landed. Auth has already applied the change when it
// returns a code, but the code itself is never checked here, so pages must not
// treat "changed" as proof (see emailNotice).
export function emailChangeStatus(params: URLSearchParams) {
  if (params.get("error")) return "failed";
  if (params.get("code")) return "changed";
  if (params.get("message")) return "one-confirmed";
  return "failed";
}

const EMAIL = {
  sent: "Check both inboxes. Your email changes only after you open the links sent to your current and new addresses.",
  "one-confirmed":
    "One address is confirmed. Open the link sent to the other address to finish.",
  changed: "Your email address has changed.",
  failed:
    "That email-change link didn't work. It may have expired or been used already. Start the change again from your account.",
};

// Signed out, the change can't be checked, so "changed" is worded conditionally.
const EMAIL_SIGNED_OUT = {
  ...EMAIL,
  changed: "If you've opened both links, sign in with your new email address.",
};

const OTHER = {
  "password-changed": "Password changed. Your other devices were signed out.",
  recheck:
    "For your security, enter a new authenticator code first. Nothing was changed.",
};

const pick = (messages: Record<string, string>, value?: string) =>
  Object.entries(messages).find(([key]) => key === value)?.[1];

export const emailNotice = (
  value: string | undefined,
  view: "signed-in" | "signed-out"
) => pick(view === "signed-in" ? EMAIL : EMAIL_SIGNED_OUT, value);

export const otherNotice = (value?: string) => pick(OTHER, value);
