import Link from "next/link";
import {
  SIGN_IN_UNAVAILABLE,
  SIGN_IN_UNCONFIGURED,
  type Host,
} from "../lib/supabase";

// Shared page content when the host's identity cannot be checked.
export function HostProblem({ state }: { state: Host["state"] }) {
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>Sign-in unavailable</h1>
      <p role="status">
        {state === "unconfigured" ? SIGN_IN_UNCONFIGURED : SIGN_IN_UNAVAILABLE}
      </p>
      <Link href="/">Back to the home page</Link>
    </main>
  );
}
