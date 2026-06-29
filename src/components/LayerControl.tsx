import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { BASEMAPS, type OverlayToggles } from '../lib/basemaps';

/**
 * Floating layer control, modeled on the DHIS2 Maps app's layer card:
 *  - basemap chooser (swatches) — switch tile source live
 *  - overlay toggles — show/hide settlement polygons, clustered points,
 *    flagged points, and boundary context
 * Collapsible so it doesn't crowd the map.
 */
const OVERLAY_LABELS: Record<keyof OverlayToggles, string> = {
  settlements: 'Settlement polygons',
  points: 'Tracker / event points',
  flagged: 'Out-of-bounds points',
  boundaries: 'Org-unit boundaries',
};

export const LayerControl: React.FC = () => {
  const { basemapId, setBasemapId, overlays, toggleOverlay } = useStore();
  const [open, setOpen] = useState(true);

  return (
    <div className={`layerctl ${open ? 'is-open' : ''}`}>
      <button className="layerctl__handle" onClick={() => setOpen((o) => !o)} title="Layers">
        <span className="layerctl__icon">▤</span>
        {open ? 'Layers' : ''}
      </button>

      {open && (
        <div className="layerctl__body">
          <div className="layerctl__section">
            <div className="layerctl__title">Basemap</div>
            <div className="layerctl__basemaps">
              {BASEMAPS.map((b) => (
                <button
                  key={b.id}
                  className={`basemap ${basemapId === b.id ? 'is-active' : ''}`}
                  onClick={() => setBasemapId(b.id)}
                  title={b.name}
                >
                  <span className="basemap__swatch" style={{ background: b.thumbnailColor }} />
                  <span className="basemap__name">{b.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="layerctl__section">
            <div className="layerctl__title">Overlays</div>
            {(Object.keys(OVERLAY_LABELS) as (keyof OverlayToggles)[]).map((key) => (
              <label key={key} className="layerctl__toggle">
                <input
                  type="checkbox"
                  checked={overlays[key]}
                  onChange={() => toggleOverlay(key)}
                />
                <span>{OVERLAY_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
