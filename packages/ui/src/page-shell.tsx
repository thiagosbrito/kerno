import type { ReactNode } from "react";

export function PageShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
