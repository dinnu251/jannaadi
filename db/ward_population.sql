-- db/ward_population.sql — GVMC 72-Ward Population & Demographic Weights
-- Source: "72 WARDS POPULATION" official GVMC document (Population Details Jul_704.pdf)
-- Total: 1,435,099 people across 72 wards. SC avg: 8.25%, ST avg: 0.79%.
--
-- PURPOSE: Populate wards.population and wards.demo_weight after Antigravity's
-- ward scrape (F-0) delivers ward names. The scrape will give (ward_number, name, lat, lng).
-- Join this table on ward_number to get population and computed demo_weight.
--
-- demo_weight formula: 0.80 + (sc_pct + st_pct) / 27.16 * 0.50
--   → range 0.81 (Ward 24, lowest SC+ST) to 1.30 (Ward 37, highest SC+ST)
--   → average ≈ 0.97, close to the 1.000 placeholder default
--   → rationale: higher SC+ST% = more demographically vulnerable = complaint weighted higher
--
-- HOW TO APPLY (after I-3 ward swap):
--   1. Antigravity delivers data/wards_real.sql with ward_number column
--   2. Run: psql $DATABASE_URL -f db/ward_population.sql
--   3. Run the UPDATE below (join on ward_number → name from wards_real)
--
-- DECK STATS: Total population 1,435,099 | 72 wards | Highest vulnerability Ward 37 (SC 26.66%)

CREATE TABLE IF NOT EXISTS ward_population_staging (
  ward_number  INTEGER PRIMARY KEY,
  total_pop    INTEGER NOT NULL,
  sc_count     INTEGER NOT NULL,
  st_count     INTEGER NOT NULL,
  sc_pct       NUMERIC(5,2) NOT NULL,
  st_pct       NUMERIC(5,2) NOT NULL,
  demo_weight  NUMERIC(4,3) GENERATED ALWAYS AS
    (ROUND(CAST(0.80 + (sc_pct + st_pct) / 27.16 * 0.50 AS NUMERIC), 3)) STORED
);

INSERT INTO ward_population_staging (ward_number, total_pop, sc_count, st_count, sc_pct, st_pct) VALUES
  ( 1,  18598,  2284,  286, 12.28, 1.54),
  ( 2,  17966,  1733,   62,  9.65, 0.35),
  ( 3,  21002,  1743,  105,  8.30, 0.50),
  ( 4,  18267,  1555,  203,  8.51, 1.11),
  ( 5,  18390,  1639,  334,  8.91, 1.82),
  ( 6,  21861,  1556,  464,  7.12, 2.12),
  ( 7,  21800,   875,  168,  4.01, 0.77),
  ( 8,  21916,  1208,   88,  5.51, 0.40),
  ( 9,  21575,  1912,  185,  8.86, 0.86),
  (10,  21920,   933,   45,  4.26, 0.21),
  (11,  21006,  1332,   90,  6.34, 0.43),
  (12,  21282,  2953,  157, 13.88, 0.74),
  (13,  21473,  1377,  182,  6.41, 0.85),
  (14,  19728,   635,   72,  3.22, 0.36),
  (15,  21868,  2300,   82, 10.52, 0.37),
  (16,  21667,  1567,   86,  7.23, 0.40),
  (17,  21418,   926,   39,  4.32, 0.18),
  (18,  19988,  1961,  122,  9.81, 0.61),
  (19,  21915,  2484,   35, 11.33, 0.16),
  (20,  20880,  1464,   27,  7.01, 0.13),
  (21,  19022,  3799,   31, 19.97, 0.16),  -- high SC: 19.97%
  (22,  19076,  2518,   12, 13.20, 0.06),
  (23,  18136,  3197,   28, 17.63, 0.15),  -- high SC: 17.63%
  (24,  17969,   117,    2,  0.65, 0.01),  -- lowest SC+ST: 0.66%
  (25,  18357,   458,   13,  2.49, 0.07),
  (26,  20663,   797,  113,  3.86, 0.55),
  (27,  19424,  1333,  144,  6.86, 0.74),
  (28,  18708,   972,  114,  5.20, 0.61),
  (29,  19020,  2220,   43, 11.67, 0.23),
  (30,  18437,  1326,   85,  7.19, 0.46),
  (31,  18582,  1194,  122,  6.43, 0.66),
  (32,  18480,   332,   15,  1.80, 0.08),
  (33,  19770,  1388,  115,  7.02, 0.58),
  (34,  18353,  1811,  370,  9.87, 2.02),
  (35,  19607,  3595,  137, 18.34, 0.70),  -- high SC: 18.34%
  (36,  20633,  2254,  144, 10.92, 0.70),
  (37,  18643,  4971,   94, 26.66, 0.50),  -- HIGHEST SC: 26.66% → demo_weight 1.300
  (38,  20776,  2312,  195, 11.13, 0.94),
  (39,  20270,  2456,  244, 12.12, 1.20),
  (40,  21372,  2371,  258, 11.09, 1.21),
  (41,  21910,  1231,  149,  5.62, 0.68),
  (42,  18439,  2714,  129, 14.72, 0.70),
  (43,  18322,  1726,  680,  9.42, 3.71),  -- high ST: 3.71%
  (44,  18295,  1076,   49,  5.88, 0.27),
  (45,  21323,  1769,  271,  8.30, 1.27),
  (46,  21544,  1201,   95,  5.57, 0.44),
  (47,  21537,  1214,  164,  5.64, 0.76),
  (48,  20394,  2565,   98, 12.58, 0.48),
  (49,  21239,  2487,   43, 11.71, 0.20),
  (50,  20873,   426,  332,  2.04, 1.59),
  (51,  18211,  1799,   64,  9.88, 0.35),
  (52,  18498,   812,  158,  4.39, 0.85),
  (53,  18847,   873,  649,  4.63, 3.44),  -- high ST: 3.44%
  (54,  19949,  3088,  731, 15.48, 3.66),  -- high SC+ST: 19.14%
  (55,  19106,   660,   48,  3.45, 0.25),
  (56,  20881,   924,  111,  4.43, 0.53),
  (57,  19781,   904,  156,  4.57, 0.79),
  (58,  18082,  1790,  367,  9.90, 2.03),
  (59,  18460,  1969,  368, 10.67, 1.99),
  (60,  18987,   675,   54,  3.56, 0.28),
  (61,  21066,   583,  135,  2.77, 0.64),
  (62,  20560,  1104,   56,  5.37, 0.27),
  (63,  18144,   552,   45,  3.04, 0.25),
  (64,  20775,   949,   56,  4.57, 0.27),
  (65,  18217,  1506,   83,  8.27, 0.46),
  (66,  19987,   905,   47,  4.53, 0.24),
  (67,  20940,  3383,  108, 16.16, 0.52),  -- high SC: 16.16%
  (68,  20534,  2392,  104, 11.65, 0.51),
  (69,  19283,   856,  166,  4.44, 0.86),
  (70,  21936,  2390,  200, 10.90, 0.91),
  (71,  18699,  1255,  131,  6.71, 0.70),
  (72,  20462,   791,  398,  3.87, 1.95);
-- TOTAL: 1,435,099 | SC: 118,427 (8.25%) | ST: 11,356 (0.79%)

-- ── Apply to wards table after F-0 ward scrape delivers ward_number column ──
-- Antigravity's wards_real.sql must include ward_number (1-72) as a column.
-- Then run:
--
-- UPDATE wards w
--    SET population  = wp.total_pop,
--        demo_weight = wp.demo_weight
--   FROM ward_population_staging wp
--  WHERE w.ward_number = wp.ward_number;
--
-- Verify: SELECT name, population, demo_weight FROM wards ORDER BY demo_weight DESC LIMIT 5;
-- Expected top: whichever wards map to numbers 37, 21, 35, 54, 23 (highest SC+ST%)
