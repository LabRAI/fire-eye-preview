# Fire-eye forecast preview

An isolated, public map of published CONUS FireWx-FM forecasts.

This preview contains the +12, +24, +36 and +48 hour windows. Forecast values describe modeled active-fire occupancy, not ignition probability. All displayed times are UTC.

The production website is unchanged. This preview does not contact the laboratory server.

Data: RAI Lab / NOAA HRRR. Map libraries: MapLibre GL JS and PMTiles; their licenses are included in assets. Basemap: Natural Earth.

The webpage is hosted on GitHub Pages and normally reads verified forecast releases from Hugging Face. It checks the publication index every five minutes while visible. If remote data cannot load, a bundled snapshot remains available; its original issue time is always displayed. The snapshot may be older than the latest release.

Public dataset: https://huggingface.co/datasets/yx21e/fire-eye-forecasts-preview
