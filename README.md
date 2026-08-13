# Circolife Maps

Single place to **see CircoLife in space** and **trust the underlying location data**.

React + MapLibre frontend (Google Maps roadmap tiles), Node sync/API backend, Postgres+PostGIS store, Zoho Analytics as the read layer.

**Tabs:** Map · Activity · Routes · Discrepancies · Gaps · Admin

## Auth

Sign in with **Zoho** (Circolife Zoho account). The Admin tab and `/api/admin/*` are limited to admin accounts.

```bash
# server/.env
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_LOGIN_REDIRECT_URI=https://maps.circolife.org/api/auth/zoho/callback
# Optional: these emails are always admin
ADMIN_EMAILS=you@circolife.com
APP_PASSWORD=...          # HMAC / production gate only — not a user login
SESSION_SECRET=...
```

In [Zoho API Console](https://api-console.zoho.in/) create a **Server-based** client (not Self Client — that one is for Analytics sync). Add Authorized Redirect URI:

`https://maps.circolife.org/api/auth/zoho/callback`

Reuse `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` only if that client is already Server-based. Otherwise set `ZOHO_LOGIN_CLIENT_ID` / `ZOHO_LOGIN_CLIENT_SECRET` to the new client and leave Analytics credentials unchanged.

Zoho login stays off until `ZOHO_LOGIN_REDIRECT_URI` is set (email/password still works until then).

First Zoho sign-in becomes admin if no admin exists yet. CRM roles matching Admin / CEO / Founder / Director are also granted admin. Everyone else gets the map without the Admin tab.

- `GET /api/auth/zoho/start` → Zoho consent → callback → session
- `/api/admin/*` requires `admin` on the account
- Public: `/healthz`, `/api/auth/*`, `/api/routes/share/:token` (RM day-route links)
- Login rate limit: ~20 attempts / 15 minutes per IP

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
# Optional local PostGIS (profile). Or use any Postgres+PostGIS and point DATABASE_URL at it.
docker network create circolife-maps-net   # once; set POSTGRES_DOCKER_NETWORK=circolife-maps-net in .env
docker compose --profile local up -d db
cd server && cp .env.example .env  # Zoho + GOOGLE_MAPS_API_KEY + APP_PASSWORD
# Local non-Docker API: DATABASE_URL=...@localhost:5432/circomap
npm i && npm run migrate && npm run load:pincodes && npm run sync && npm run dev
cd ../web && npm i && npm run dev
```

`load:pincodes` seeds ~11k India pincode centroids used when a row has no lat/long
and street geocoding misses. Without it, the pipeline falls through to territory
centroids only.

Open http://localhost:4040 — sign in with Zoho (set `ZOHO_LOGIN_REDIRECT_URI`). Use **Admin → Clear failed + re-geocode** after first sync, then **Rebuild discrepancies** (or full sync, which rebuilds automatically).

Optional: `npm run regeocode` in `server/`.

## Production deploy (Docker, shared Postgres)

Default on the Circolife server: **app container only**, new database inside existing `circolife-ai-postgres` (other DBs untouched). Requires **PostGIS** in that Postgres instance. UI on host port **4040**.

### 1. Discover network + create DB

```bash
# Network name the map app must join
docker inspect circolife-ai-postgres -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'

# Superuser is usually the image default (often `postgres`) — check the AI stack .env if this fails.
# Pick a strong password for circomap and keep it for DATABASE_URL.
docker exec -it circolife-ai-postgres psql -U postgres -d postgres -c \
  "CREATE USER circomap WITH PASSWORD 'CHANGE_ME';"
docker exec -it circolife-ai-postgres psql -U postgres -d postgres -c \
  "CREATE DATABASE circomap OWNER circomap;"
```

### 2. Install PostGIS (once per container lifetime)

`pgvector/pgvector:pg16` does not ship PostGIS. Install into the running container (re-run after that container is recreated from a non-PostGIS image):

```bash
docker exec -u root -it circolife-ai-postgres bash -c \
  "apt-get update && apt-get install -y postgresql-16-postgis-3 && rm -rf /var/lib/apt/lists/*"
docker exec -it circolife-ai-postgres psql -U postgres -d circomap -c \
  "CREATE EXTENSION IF NOT EXISTS postgis;"
docker exec -it circolife-ai-postgres psql -U postgres -d circomap -c \
  "GRANT ALL ON SCHEMA public TO circomap;"
docker exec -it circolife-ai-postgres psql -U postgres -d circomap -c \
  "ALTER DATABASE circomap OWNER TO circomap;"
```

### 3. Env on the server

Root `.env` (Compose variable substitution):

```bash
APP_PUBLISH_PORT=4040
POSTGRES_DOCKER_NETWORK=<name from step 1>
```

`server/.env` (loaded into the app container):

```bash
DATABASE_URL=postgres://circomap:CHANGE_ME@circolife-ai-postgres:5432/circomap
NODE_ENV=production
APP_PASSWORD=...
SESSION_SECRET=...
GOOGLE_MAPS_API_KEY=...
# Zoho credentials…
# CORS_ORIGINS=https://maps.circolife.org
# ZOHO_LOGIN_REDIRECT_URI=https://maps.circolife.org/api/auth/zoho/callback
# ADMIN_EMAILS=you@circolife.com
```

Hostname `circolife-ai-postgres` resolves only when the app shares that container’s Docker network (`POSTGRES_DOCKER_NETWORK`).

### 4. Build, start, sync

```bash
cd ~/circolife-map
docker compose up -d --build
curl -s http://127.0.0.1:4040/healthz
docker compose exec app npm run sync   # first Zoho load — can take a while
```

Open `https://maps.circolife.org` and sign in with Zoho. Entrypoint runs migrate + pincode seed automatically.

- Health: `GET /healthz` → `{ ok: true }` (DB ping)
- Cron: `docker compose exec app npm run sync` daily (or Admin → Sync)
- Google Cloud: enable **Geocoding**, **Map Tiles**, **Directions** (Routes optional). Restrict the browser key by HTTP referrer.

### Alternative: bare Node (no Docker app)

```bash
cd web && npm ci && npm run build
# server/.env with DATABASE_URL / NODE_ENV=production / APP_PASSWORD / …
cd ../server && npm ci && npm run migrate && npm start
```

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
