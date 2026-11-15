"""Tiny hand-checkable fixtures.

Layout (all 2025-03-10 unless noted):
 - Three VIIRS points within ~1 km of each other near (21.0, 81.0) -> one
   DBSCAN cluster (eps 2.5 km, min_samples 3).
 - One MODIS point within ~0.7 km of all three VIIRS cluster points, 30 min
   later -> three candidate cross-sensor links (<=1.5 km, <=3 h): one 1 km
   MODIS pixel overlapping several 375 m VIIRS pixels.
 - One far-away VIIRS point near (24.5, 85.5) -> isolated / noise.
"""

MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight
21.004,81.0,310.5,1.0,1.0,2025-03-10,530,Aqua,85,6.1,295.2,12.4,D
"""

VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type
21.0,81.0,305.1,0.4,0.4,2025-03-10,500,N,VIIRS,h,2,290.1,10.2,D,0
21.002,81.003,304.0,0.4,0.4,2025-03-10,500,N,VIIRS,n,2,289.0,8.1,D,0
20.998,80.997,303.2,0.4,0.4,2025-03-10,500,N,VIIRS,l,2,288.4,5.0,N,0
24.5,85.5,302.0,0.4,0.4,2025-03-10,700,N,VIIRS,n,2,287.0,3.3,D,0
"""

GEOJSON = """{
  "type": "FeatureCollection",
  "features": [
    {"type": "Feature",
     "geometry": {"type": "Point", "coordinates": [81.0, 21.0]},
     "properties": {"latitude": 21.0, "longitude": 81.0,
                    "bright_ti4": 305.1, "acq_date": "2025-03-10",
                    "acq_time": 500, "satellite": "N", "instrument": "VIIRS",
                    "confidence": "h", "bright_ti5": 290.1, "frp": 10.2,
                    "daynight": "D"}},
    {"type": "Feature",
     "geometry": {"type": "Point", "coordinates": [81.0, 21.004]},
     "properties": {"latitude": 21.004, "longitude": 81.0,
                    "brightness": 310.5, "acq_date": "2025-03-10",
                    "acq_time": "0530", "satellite": "Aqua",
                    "confidence": 42, "bright_t31": 295.2, "frp": 12.4,
                    "daynight": "D"}}
  ]
}
"""
