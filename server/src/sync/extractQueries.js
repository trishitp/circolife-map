// Extraction SQL against CRM Analytics workspace 441267000002068095.
// ALL column names below verified against live view metadata (2026-08-10),
// including the double space in "Joint  Meeting".
//
// Audit findings baked in (measured live):
//  - Leads: "Latitude"/"Longitude" 0% -> not selected. "City" 0.06% -> use
//    "Billing City" (95%). Pin Code 88%. Shipping Street/Code secondary (~29%).
//    Search Address lat/long 4.3% overall, 12.9% of new leads since Apr 2026.
//    Leads has no "Street 2" / "Billing Street 2" in Analytics (CRM UI may show it).
//    Leads DOES have Shipping Street 2 + Shipping/Billing City/State/Country.
//  - Meetings: 95.8% have native check-in Latitude/Longitude. Joint = 202 rows.
//  - Accounts: Billing Street 2, Shipping Street 2, Billing City., Billing State /
//    Region, Billing Country / Nation present. Billing Code historically empty —
//    also inherit lead Pin Code / Zip Code.
//  - Assets: "Asset Status" is unmaintained (only ~13 "Installed"; most are "New").
//    Installation Date covers ~32% (3.6k of 11k) — do NOT use it as the sync filter
//    or the map undercounts the installed base. Sync all assets except Uninstalled.
//    Title prefers Asset Number; when FSM Address is missing/unusable, fall back
//    to linked account shipping (then billing), geocoded — not only account pin.
//
// ⚠ PRECISION: Analytics *display-formats* Meetings.Latitude/Longitude and Leads
// "Search Address - Lat/Long" at 2 decimal places (~1.1 km). The stored values
// still have full GPS (~6 dp). Always export with CAST(... AS CHAR) so CSV
// bulk export keeps full precision; isLowPrecisionCoord then marks exact.
//
// Location sources for Discrepancies:
//  - mmi     = MapMyIndia Search Address lat/lng (CRM widget)
//  - billing = full billing address (street + street2 + city + state + pin + country)
//  - shipping= full shipping address
//  - checkin = Meeting field-agent check-in coords linked to lead/account

// CRM Users — Status is active|disabled; Role Name drives map filters.
export const USERS_SQL = `
SELECT "Id", "Full Name", "Email", "Status", "Role Name", "Profile Name",
       "Modified Time"
FROM "Users"`;

export const LEADS_SQL = `
SELECT "Id", "Full Name", "Company", "Lead Owner Name", "Lead Status",
       "Lead Source", "Lead Territory",
       "Street",
       "Shipping Street", "Shipping Street 2",
       "Pin Code", "Zip Code", "Shipping Code",
       "Billing City", "City", "Shipping City",
       "Billing State", "State", "Shipping State",
       "Billing Country", "Country", "Shipping Country",
       CAST("Search Address - Latitude" AS CHAR) AS s_lat,
       CAST("Search Address - Longitude" AS CHAR) AS s_lng,
       "Created Time", "Modified Time", "Is Converted", "Converted Account"
FROM "Leads"
WHERE "Lead Status" NOT IN ('Junk')`;

export const ACCOUNTS_SQL = `
SELECT a."Id" AS "Id", a."Account Name" AS "Account Name",
       a."Account Owner Name" AS owner,
       a."Billing Street" AS "Billing Street",
       a."Billing Street 2" AS "Billing Street 2",
       a."Billing City" AS "Billing City",
       a."Billing City." AS "Billing City Dot",
       a."Billing State" AS "Billing State",
       a."Billing State / Region" AS "Billing State Region",
       a."Billing Country" AS "Billing Country",
       a."Billing Country / Nation" AS "Billing Country Nation",
       a."Billing Code" AS "Billing Code",
       a."Pin Code" AS "Account Pin Code",
       a."Shipping Street" AS "Shipping Street",
       a."Shipping Street 2" AS "Shipping Street 2",
       a."Shipping City" AS "Shipping City",
       a."Shipping State" AS "Shipping State",
       a."Shipping Country" AS "Shipping Country",
       a."Shipping Code" AS "Shipping Code",
       l."Pin Code" AS lead_pincode, l."Zip Code" AS lead_zip,
       l."Shipping Code" AS lead_ship_code,
       l."Street" AS lead_street,
       l."Shipping Street" AS lead_shipping_street,
       l."Shipping Street 2" AS lead_shipping_street2,
       l."Billing City" AS lead_billing_city,
       l."Shipping City" AS lead_shipping_city,
       l."Billing State" AS lead_billing_state,
       l."Shipping State" AS lead_shipping_state,
       l."Billing Country" AS lead_billing_country,
       l."Shipping Country" AS lead_shipping_country,
       CAST(l."Search Address - Latitude" AS CHAR) AS s_lat,
       CAST(l."Search Address - Longitude" AS CHAR) AS s_lng,
       l."Lead Territory" AS territory,
       a."Created Time" AS "Created Time", a."Modified Time" AS "Modified Time"
FROM "Accounts" a
LEFT JOIN "Leads" l ON l."Converted Account" = a."Id"`;

export const MEETINGS_SQL = `
SELECT m."Id" AS "Id", m."Title" AS "Title", m."Host Name" AS owner, m."From" AS start_ts,
       CAST(m."Latitude" AS CHAR) AS lat, CAST(m."Longitude" AS CHAR) AS lng,
       m."Check-In Time" AS checkin_time, m."Checked In Status" AS checkin_status,
       m."Joint  Meeting" AS is_joint, m."Meeting Outcome" AS outcome,
       m."LEADID" AS lead_id, m."ACCOUNTID" AS account_id,
       m."Created Time" AS "Created Time", m."Modified Time" AS "Modified Time"
FROM "Meetings" m`;

export const ASSETS_SQL = `
SELECT CAST(s."Id" AS CHAR) AS "Id",
       s."Asset Name" AS "Asset Name",
       s."Asset Number" AS "Asset Number", s."mac id" AS mac,
       s."AC Type" AS "AC Type", s."Tonnage" AS "Tonnage",
       s."Asset Status" AS "Asset Status",
       s."Installation Date" AS "Installation Date",
       CAST(s."Company" AS CHAR) AS account_id,
       CAST(s."Address" AS CHAR) AS address_id,
       s."Created Time" AS "Created Time", s."Modified Time" AS "Modified Time"
FROM "Assets" s
WHERE s."Asset Status" IS NULL OR s."Asset Status" NOT IN ('Uninstalled')`;

// Shipping / billing for assets fallback when FSM Address is missing.
// Joins converted Lead for Shipping Street/Code (Accounts.Billing Code is empty).
export const ACCOUNT_ADDRESS_SQL = `
SELECT CAST(a."Id" AS CHAR) AS account_id,
       a."Billing Street" AS billing_street,
       a."Billing Street 2" AS billing_street2,
       a."Billing City" AS billing_city,
       a."Billing City." AS billing_city_dot,
       a."Billing State" AS billing_state,
       a."Billing State / Region" AS billing_state_region,
       a."Billing Country" AS billing_country,
       a."Billing Country / Nation" AS billing_country_nation,
       a."Billing Code" AS billing_code,
       a."Pin Code" AS account_pin,
       a."Shipping Street" AS shipping_street,
       a."Shipping Street 2" AS shipping_street2,
       a."Shipping City" AS shipping_city,
       a."Shipping State" AS shipping_state,
       a."Shipping Country" AS shipping_country,
       a."Shipping Code" AS shipping_code,
       l."Street" AS lead_street,
       l."Shipping Street" AS lead_shipping_street,
       l."Shipping Street 2" AS lead_shipping_street2,
       l."Shipping Code" AS lead_shipping_code,
       l."Pin Code" AS lead_pincode,
       l."Zip Code" AS lead_zip,
       l."Billing City" AS lead_billing_city,
       l."Shipping City" AS lead_shipping_city,
       l."Billing State" AS lead_billing_state,
       l."Shipping State" AS lead_shipping_state,
       l."Billing Country" AS lead_billing_country,
       l."Shipping Country" AS lead_shipping_country,
       l."Lead Territory" AS territory
FROM "Accounts" a
LEFT JOIN "Leads" l ON l."Converted Account" = a."Id"`;

// FSM workspace 441267000003723011 ("Zoho FSM Analytics").
// Addresses coverage audited 2026-07-23: street 92%, city 97%, zip 97% —
// the best address data in the stack. No lat/long synced -> geocode pipeline.
export const FSM_ADDRESSES_SQL = `
SELECT "Id", "Street 1", "City", "State", "Zip Code", "Country"
FROM "Addresses"`;

// Bridge: Assets.Company is an FSM Company id (524…). Shipping lives on CRM
// Accounts (937…). Companies."ZCRM Id" is the join key. Service/Billing Address
// are FSM Address lookups used when the Asset.Address field is empty.
export const FSM_COMPANIES_SQL = `
SELECT CAST(c."Id" AS CHAR) AS company_id,
       c."Company Name" AS company_name,
       CAST(c."ZCRM Id" AS CHAR) AS zcrm_id,
       CAST(c."Service Address" AS CHAR) AS service_address_id,
       CAST(c."Billing Address" AS CHAR) AS billing_address_id
FROM "Companies" c`;
