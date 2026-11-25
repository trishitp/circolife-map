-- Replace legacy Agra-template centroids (27.2384, 78.7478) with plausible local coords.
-- Source of the bad template was IN-pincodes / pincodes.csv rows for Ghaziabad (2010xx/2012xx)
-- and Hathras-area (204xxx) pins.

UPDATE pincode_centroids SET lat = 28.6820, lng = 77.4780 WHERE pincode = '201009';
UPDATE pincode_centroids SET lat = 28.6650, lng = 77.4450 WHERE pincode = '201011';
UPDATE pincode_centroids SET lat = 28.5520, lng = 77.5550 WHERE pincode = '201201';
UPDATE pincode_centroids SET lat = 27.5950, lng = 78.0500 WHERE pincode = '204101';
UPDATE pincode_centroids SET lat = 27.6000, lng = 78.0550 WHERE pincode = '204104';
UPDATE pincode_centroids SET lat = 27.6200, lng = 78.0800 WHERE pincode = '204212';
UPDATE pincode_centroids SET lat = 27.5900, lng = 78.0400 WHERE pincode = '204215';
UPDATE pincode_centroids SET lat = 27.5970, lng = 78.0520 WHERE pincode = '204216';

-- Replot coarse points that still sit on the Agra template for these pins.
UPDATE map_points mp
SET
  lat = pc.lat,
  lng = pc.lng,
  geom = ST_SetSRID(ST_MakePoint(pc.lng, pc.lat), 4326),
  updated_at = now()
FROM pincode_centroids pc
WHERE mp.pincode = pc.pincode
  AND mp.pincode IN (
    '201009', '201011', '201201',
    '204101', '204104', '204212', '204215', '204216'
  )
  AND mp.precision IN ('pincode', 'inherited', 'approx')
  AND ABS(mp.lat - 27.2384) < 0.02
  AND ABS(mp.lng - 78.7478) < 0.02;
