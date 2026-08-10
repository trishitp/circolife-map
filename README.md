# Circolife Maps

Single place to **see CircoLife in space** and **trust the underlying location data**.

React + MapLibre frontend (Google Maps roadmap tiles), Node sync/API backend, Postgres+PostGIS store, Zoho Analytics as the read layer.

**Tabs:** Map · Activity · Routes · Discrepancies · Gaps · Admin

## Auth

One app password gates the product (map, activity, routes, gaps, discrepancies, admin).

```bash
# server/.env
APP_PASSWORD=your-shared-secret

# Production extras:
# NODE_ENV=production
# CORS_ORIGINS=https://maps.yourdomain.com
# DATABASE_SSL=true
# SESSION_SECRET=long-random-string
# ADMIN_TOKEN=different-secret   # optional; Admin writes then need X-Admin-Token
```

- `POST /api/auth/login` → session token (Bearer)
- All other `/api/*` routes require the token when `APP_PASSWORD` is set
- Public: `/healthz`, `/api/auth/*`, `/api/routes/share/:token` (RM day-route links)
- Empty `APP_PASSWORD` = open APIs (**local only**; refused when `NODE_ENV=production`)
- Login rate limit: ~20 attempts / 15 minutes per IP
- If `APP_PASSWORD` and a **different** `ADMIN_TOKEN` are both set, Admin mutations require header `X-Admin-Token`

## Architecture

```
cron / Admin ──> server/src/sync/sync.js
           │  Zoho Analytics bulk-export SQL
           ▼
       map_points + location_signals
           │
           ├── GeoJSON layers → Map tab
           ├── address_discrepancies → Discrepancies tab
           └── unplottable_log → Gaps tab
```

## Location sources (Discrepancies)

| Source | Meaning |
|---|---|
| **mmi** | MapMyIndia Search Address lat/lng on the CRM record |
| **billing** | Billing / primary street + pin (geocoded when needed) |
| **shipping** | Shipping street + shipping code |
| **checkin** | Field-agent meeting check-in coords linked to lead/account |

Thresholds: **watch** ≥ 1 km between any two sources, **alert** ≥ 3 km. Pin-code mismatch alone → at least **watch**.

Gaps = cannot plot. Discrepancies = can plot (or partially resolve) but sources disagree or a source is missing.

## Audit-driven design decisions (measured 2026-07-23, live data)

| Source | Rows | Finding | Consequence in code |
|---|---|---|---|
| Leads | 74,378 | `Latitude`/`Longitude` 100% empty; `City` 99.9% empty; `Search Address - Lat/Long` 4.3%; **Pin Code 88%** | Tier-0 uses Search Address lat/long; geocode query = Street + Pin Code + territory city (never the City field); pincode then territory centroid fallbacks |
| Accounts | 4,205 | **Billing Code 0%**, Billing City 7%, Billing Street 78% | Account pincode inherited from converted Lead where possible; else street geocode / territory |
| Meeting Check-In | high volume with 2dp lat/lng | Check-in adopted widely but Analytics rounds to ~1 km | Meetings layer = all meetings; check-in → `approx`; else inherit lead/account |
| Assets (FSM) | 10,446 | `Asset Status` unmaintained; `Address` is a lookup id | Non-Uninstalled assets synced; location = FSM address or linked Account |

## Run (local)

```bash
docker compose up -d db   # or local Postgres+PostGIS
cd server && cp .env.example .env  # Zoho + GOOGLE_MAPS_API_KEY + APP_PASSWORD
npm i && npm run migrate && npm run load:pincodes && npm run sync && npm run dev
cd ../web && npm i && npm run dev
```

`load:pincodes` seeds ~11k India pincode centroids used when a row has no lat/long
and street geocoding misses. Without it, the pipeline falls through to territory
centroids only.

Open http://localhost:5173 — sign in with `APP_PASSWORD`. Use **Admin → Clear failed + re-geocode** after first sync, then **Rebuild discrepancies** (or full sync, which rebuilds automatically).

Optional: `npm run regeocode` in `server/`.

## Production deploy

```bash
# 1. Build SPA
cd web && npm ci && npm run build

# 2. server/.env
# NODE_ENV=production
# APP_PASSWORD=...
# DATABASE_URL=...
# DATABASE_SSL=true          # managed Postgres
# CORS_ORIGINS=https://maps.example.com
# GOOGLE_MAPS_API_KEY=...    # restrict in GCP by referrer + server IP
# WEB_DIST=/path/to/web/dist # optional; auto-detects ../web/dist

# 3. Start API (serves SPA when dist present)
cd ../server && npm ci && npm run migrate && npm start
```

- Health: `GET /healthz` → `{ ok: true }` (DB ping)
- Cron: `cd server && npm run sync` daily (or Admin → Sync)
- Google Cloud: enable **Geocoding**, **Map Tiles**, **Directions** (Routes optional). Restrict the browser key by HTTP referrer.

## Filters (Map)

- Field agent, territory, status, precision (searchable where long lists)
- Meeting type joint/normal → **meetings layer only**
- **Recorded date** (not “Created”): IST day bounds on `record_ts`
- Active filters as removable chips on the map
- Dense viewports may truncate to the latest ~8000 points per layer (banner warns to zoom in)

## Routes

Plan a day for an RM, optimize on roads, **Share to RM** → mobile `#/r/<token>` view (map + navigate + CRM only).

## Geocoding tiers (no fake city-centre pins)

1. **exact** — CRM lat/lng at >2 decimal places (Search Address / check-in)
2. **geocoded** — Google/Ola street-level hit on full address
3. **approx** — CRM lat/lng at ≤2dp (~1.1 km Analytics rounding)
4. **pincode** — `pincode_centroids`
5. **territory** — mean of plotted peers in the same territory
6. **inherited** — meetings/assets from related lead/account
7. **none** — Gaps only; never plotted at (0,0)

## Layers & brand colors

Leads `#A14996` · Accounts `#2E1F40` · Meetings `#BDE0ED` · Assets `#D0F0C0` · Canvas `#FEF9F5`
