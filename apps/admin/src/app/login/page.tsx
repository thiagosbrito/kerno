import { safeRedirectPath } from "@kerno/contracts";
import { PageShell } from "@kerno/ui";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <PageShell title="Sign in to KERNO Admin">
      <LoginForm next={safeRedirectPath(Array.isArray(next) ? next[0] : next)} />
    </PageShell>
  );
}
