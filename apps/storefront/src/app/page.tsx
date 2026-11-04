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
  const { displayName, defaultLocale, currency, homepageMode } = profile.profile;
  // POC (THI-67): render each store's own public configuration so isolation is observable.
  return (
    <div lang={defaultLocale} data-homepage-mode={homepageMode}>
      <PageShell title={displayName}>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>Language</dt>
          <dd data-testid="locale">{defaultLocale}</dd>
          <dt>Currency</dt>
          <dd data-testid="currency">{currency}</dd>
          <dt>Homepage</dt>
          <dd data-testid="homepage-mode">{homepageMode}</dd>
        </dl>
      </PageShell>
    </div>
  );
}
