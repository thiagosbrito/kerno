-- LOCAL DEVELOPMENT FIXTURES ONLY. Applied by `supabase db reset` (see [db.seed] in config.toml).
-- Fake data, no real people or credentials. Never run against a real project.
--
-- Three active stores in three organizations, one deployment serves them all:
--   http://acme-sneakers.localhost:3001  (en, USD; also a verified primary custom domain)
--   http://acme-books.localhost:3001     (pt-BR, BRL; a pending, unverified custom domain)
--   http://acme-plants.localhost:3001    (pl, PLN)
-- plus a draft and a suspended store that must never resolve.

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Acme Sneakers'),
  ('10000000-0000-4000-8000-0000000000e2', 'Acme Books'),
  ('10000000-0000-4000-8000-0000000000e3', 'Acme Plants');

insert into public.stores (id, organization_id, slug, name, status) values
  ('20000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'acme-sneakers', 'Acme Sneakers', 'active'),
  ('20000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e2', 'acme-books', 'Acme Books', 'active'),
  ('20000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e3', 'acme-plants', 'Acme Plants', 'active'),
  ('20000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-0000000000e3', 'acme-draft', 'Acme Draft', 'draft'),
  ('20000000-0000-4000-8000-0000000000e5', '10000000-0000-4000-8000-0000000000e3', 'acme-suspended', 'Acme Suspended', 'suspended');

insert into public.store_public_profiles (store_id, display_name, default_locale, currency, homepage_mode) values
  ('20000000-0000-4000-8000-0000000000e1', 'Acme Sneakers', 'en', 'USD', 'catalog'),
  ('20000000-0000-4000-8000-0000000000e2', 'Acme Livros', 'pt-BR', 'BRL', 'landing'),
  ('20000000-0000-4000-8000-0000000000e3', 'Acme Rośliny', 'pl', 'PLN', 'landing'),
  ('20000000-0000-4000-8000-0000000000e4', 'Acme Draft', 'en', 'USD', 'landing'),
  ('20000000-0000-4000-8000-0000000000e5', 'Acme Suspended', 'en', 'USD', 'landing');

-- Verified primary custom domain for sneakers; unverified claim for books; a verified
-- domain on the suspended store (must not resolve).
insert into public.store_domains (store_id, hostname, verified_at, is_primary) values
  ('20000000-0000-4000-8000-0000000000e1', 'shop.acme-sneakers.test', now(), true),
  ('20000000-0000-4000-8000-0000000000e2', 'pending.acme-books.test', null, false),
  ('20000000-0000-4000-8000-0000000000e5', 'shop.acme-suspended.test', now(), false);
