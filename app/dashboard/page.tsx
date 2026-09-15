import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Dashboard</h1>
      <p>Signed in as {user.email}</p>
    </main>
  );
}
