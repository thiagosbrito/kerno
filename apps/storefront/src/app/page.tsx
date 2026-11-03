import { getStoreRouter } from "@kerno/server";
import { PageShell } from "@kerno/ui";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

// Host-dependent, so never statically rendered or shared between hosts.
export const dynamic = "force-dynamic";

export default async function Home() {
  const router = getStoreRouter();
  // Re-resolve here instead of trusting the proxy alone (defense in depth).
  const decision = await router.route(await headers());
  if (decision.action === "unavailable") throw new Error("store directory unavailable");
  if (decision.action !== "serve") notFound();
  const profile = await router.profile(decision.resolution.store.storeId);
  if (profile.status !== "found") {
    if (profile.status === "unavailable") throw new Error("store profile unavailable");
    notFound();
  }
  return <PageShell title={profile.profile.displayName} />;
}
