# Fire-eye independent platform preview

An independent, public map of published CONUS FireWx-FM forecasts and environmental observations.

This preview contains the +12, +24, +36 and +48 hour windows. Forecast values describe modeled active-fire occupancy, not ignition probability. All displayed times are UTC.

The production website is unchanged. This preview does not contact the laboratory server.

Data: RAI Lab / NOAA HRRR. Map libraries: MapLibre GL JS and PMTiles; their licenses are included in assets. Basemaps: OpenFreeMap / OpenMapTiles / OpenStreetMap and Natural Earth.

Restored features include published fire reports and perimeters, satellite detections, drought, soil moisture, weather advisories, regional charts, coordinate/incident search, source dates, downloads and a rolling archive of sixty complete forecast issues. The Simulation button runs the original illustrative scene rules in a browser worker and displays real 3 km landscape context. Flamme, visitor writes, what-if computation and the 50 m lab are not yet migrated.

The webpage is hosted on GitHub Pages and normally reads verified forecast releases from Hugging Face. It checks the publication index every five minutes while visible. If remote data cannot load, a bundled snapshot remains available; its original issue time is always displayed. The snapshot may be older than the latest release.

Public dataset: https://huggingface.co/datasets/yx21e/fire-eye-forecasts-preview
