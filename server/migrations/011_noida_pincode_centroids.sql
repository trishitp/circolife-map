-- Fix Noida pincodes 201303/201304 (were duplicated Agra-area coords in source CSV).

UPDATE pincode_centroids
SET lat = 28.5640, lng = 77.3500
WHERE pincode = '201303';

UPDATE pincode_centroids
SET lat = 28.5670, lng = 77.3550
WHERE pincode = '201304';

-- Reposition map points that were plotted from the bad centroids.
UPDATE map_points mp
SET
  lat = pc.lat,
  lng = pc.lng,
  geom = ST_SetSRID(ST_MakePoint(pc.lng, pc.lat), 4326),
  updated_at = now()
FROM pincode_centroids pc
WHERE mp.pincode = pc.pincode
  AND mp.pincode IN ('201303', '201304')
  AND mp.precision IN ('pincode', 'inherited', 'approx')
  AND mp.lat BETWEEN 27.0 AND 27.5
  AND mp.lng BETWEEN 78.0 AND 79.0;
