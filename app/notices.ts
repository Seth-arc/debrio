// Status messages chosen by allow-listed query values; unknown values show nothing.
const EMAIL = {
  sent: "Check both inboxes. Your email changes only after you open the links sent to your current and new addresses.",
  "one-confirmed":
    "One address is confirmed. Open the link sent to the other address to finish.",
  changed: "Your email address has changed.",
  failed:
    "That email-change link didn't work. It may have expired or been used already. Start the change again from your account.",
};

const PASSWORD = {
  changed: "Password changed. Your other devices were signed out.",
};

const pick = (messages: Record<string, string>, value?: string) =>
  Object.entries(messages).find(([key]) => key === value)?.[1];

export const emailNotice = (value?: string) => pick(EMAIL, value);
export const passwordNotice = (value?: string) => pick(PASSWORD, value);
