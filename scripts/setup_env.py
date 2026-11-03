#!/usr/bin/env python3
"""Create apps/*/.env.local with non-secret local placeholders. Never overwrites existing files."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
values = {
    "NEXT_PUBLIC_ADMIN_URL": "http://localhost:3000",
    "NEXT_PUBLIC_STOREFRONT_URL": "http://localhost:3001",
    "NEXT_PUBLIC_SUPABASE_URL": "http://localhost:54321",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "local-placeholder-anon-key",
    "SUPABASE_SERVICE_ROLE_KEY": "local-placeholder-service-role-key",
}
for app in ("admin", "storefront"):
    target = root / "apps" / app / ".env.local"
    if target.exists():
        print(f"kept existing {target.relative_to(root)}")
        continue
    extra = {"PLATFORM_DOMAIN": "localhost"} if app == "storefront" else {}
    target.write_text("".join(f"{k}={v}\n" for k, v in {**values, **extra}.items()))
    print(f"created {target.relative_to(root)}")
