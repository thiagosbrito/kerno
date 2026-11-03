import { getServerEnv } from "@kerno/server";
import { PageShell } from "@kerno/ui";

export const dynamic = "force-dynamic";

export default function Home() {
  // Fails closed on malformed configuration; renders only a boolean, never values.
  getServerEnv();
  return <PageShell title="KERNO Storefront" />;
}
