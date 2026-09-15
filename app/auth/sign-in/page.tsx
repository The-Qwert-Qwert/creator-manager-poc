"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  if (sent) {
    return <p style={styles.msg}>Check your email — magic link sent to {email}.</p>;
  }

  return (
    <main style={styles.wrap}>
      <h1 style={styles.h1}>Sign in</h1>
      <form onSubmit={handleMagicLink} style={styles.form}>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
        />
        <button type="submit" style={styles.btn}>Send magic link</button>
      </form>
      {error && <p style={styles.err}>{error}</p>}
      <hr style={styles.hr} />
      <button onClick={handleGoogle} style={styles.btn}>Continue with Google</button>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { fontFamily: "sans-serif", maxWidth: 360, margin: "4rem auto", padding: "0 1rem" },
  h1:   { marginBottom: "1.5rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  input: { padding: "0.5rem", fontSize: "1rem", borderRadius: 4, border: "1px solid #ccc" },
  btn:  { padding: "0.6rem 1rem", fontSize: "1rem", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc" },
  hr:   { margin: "1.5rem 0" },
  msg:  { fontFamily: "sans-serif", maxWidth: 360, margin: "4rem auto", padding: "0 1rem" },
  err:  { color: "red", marginTop: "0.5rem" },
};
