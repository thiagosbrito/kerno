import { orgRoleSchema } from "@kerno/contracts";
import { verifySession } from "@kerno/server";
import { PageShell } from "@kerno/ui";
import { redirect } from "next/navigation";
import { requestAuth } from "../lib/auth";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await requestAuth();
  // The proxy already checked, but a page never trusts that it ran.
  const session = await verifySession(auth.client);
  if (session.status === "unauthenticated") redirect("/login");
  if (session.status === "unavailable") throw new Error("Session check unavailable");

  // Through the user's own credentials. RLS lets a member see every membership of their organizations,
  // so filter to the caller's own rows or other members' roles would be listed as theirs.
  const { data, error } = await auth.client.from("memberships").select("role, organizations(name)").eq("user_id", session.userId);
  if (error) throw new Error("Membership lookup unavailable");
  const rows = (data ?? []).flatMap((row) => {
    const role = orgRoleSchema.safeParse((row as { role?: unknown }).role);
    const org = (row as { organizations?: { name?: unknown } | null }).organizations;
    return role.success && typeof org?.name === "string" ? [{ role: role.data, name: org.name }] : [];
  });

  return (
    <PageShell title="KERNO Admin">
      <h2 className="mt-6 text-lg font-medium">Your organizations</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm">You are not a member of any organization.</p>
      ) : (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {rows.map((row, i) => (
            <li key={i}>
              {row.name} · {row.role}
            </li>
          ))}
        </ul>
      )}
      <form action={logout} className="mt-8">
        <button type="submit" className="rounded border px-3 py-2 text-sm">
          Sign out
        </button>
      </form>
    </PageShell>
  );
}
