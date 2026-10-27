# Fire-eye independent platform preview

An independent, public map of published CONUS FireWx-FM forecasts and environmental observations.

This preview contains the +12, +24, +36 and +48 hour windows. Forecast values describe modeled active-fire occupancy, not ignition probability. All displayed times are UTC.

The production website is unchanged. This preview does not contact the laboratory server.

Data: RAI Lab / NOAA HRRR. Map libraries: MapLibre GL JS and PMTiles; their licenses are included in assets. Basemaps: OpenFreeMap / OpenMapTiles / OpenStreetMap and Natural Earth.

Restored features include published fire reports and perimeters, satellite detections, drought, soil moisture, weather advisories, regional charts, city/county/state/coordinate/incident search, source dates, downloads and a rolling archive of sixty complete forecast issues. The Simulation button runs the original illustrative scene rules in a browser worker and displays real 3 km landscape context. Dated incident-history queries are available under Details. Six landscape and exposure backgrounds are delivered on demand from HF, retaining original display tiles through zoom 10. Deeper views magnify these tiles; this is not native-resolution numeric analysis. The independent Flamme service and conversation interface pass local tests but are not enabled publicly by user choice. WUI, historical burn-severity polygons and Microsoft building outlines use spatially indexed HF sources with viewport and resource limits. Source years are explicitly listed; missing archive years are not treated as zero. Atlantic advisory tracks from the installed 2010–2025 archive are available by season and storm; they are historical context, not live warnings. Viewport vector queries use verified index prefixes and a bounded in-memory cache. The separate resolution lab displays 53 existing October windows with verified 50 m experimental terrain/fuel detail; it is retrospective refinement of 5 km fields, not a native 50 m forecast. What-if comparisons use verified paired model outputs, synchronized maps and a maintainer-approved GitHub request queue. The browser never calls laboratory APIs; requests require a GitHub account and their settings are public. Treatment dates are context only, not a recovery simulation. Visitor writes are not yet migrated.

The webpage is hosted on GitHub Pages and normally reads verified forecast releases from Hugging Face. It checks the publication index every five minutes while visible. If remote data cannot load, a bundled snapshot remains available; its original issue time is always displayed. The snapshot may be older than the latest release.

Public dataset: https://huggingface.co/datasets/yx21e/fire-eye-forecasts-preview
