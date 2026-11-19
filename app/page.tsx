import Link from "next/link";
export default function Home() {
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>A space for better workshops.</h1>
      <p>Run structured workshops on your own or with a team.</p>
      <nav aria-label="Account" className="actions">
        <Link href="/sign-in">Sign in</Link>
        <Link href="/sign-up">Create an account</Link>
      </nav>
      <a href="/api/health">Check application health</a>
    </main>
  );
}
