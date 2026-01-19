import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Coordinates, GeocodedAddress } from '../api/client';

// Fix Leaflet default marker icon issue
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom icons
const depotIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const targetIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const pendingIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export type SelectionMode = 'depot' | 'target' | null;

interface MarkerData {
  id: string;
  type: 'depot' | 'target' | 'pending';
  coordinates: Coordinates;
  address?: GeocodedAddress;
  label?: string;
}

interface MapViewProps {
  center: Coordinates;
  zoom?: number;
  depot?: GeocodedAddress | null;
  targets?: GeocodedAddress[];
  selectionMode: SelectionMode;
  onMapClick?: (coordinates: Coordinates) => void;
  onCenterChange?: (center: Coordinates) => void;
  pendingMarker?: Coordinates | null;
  style?: React.CSSProperties;
}

// Component to handle map click events
const MapClickHandler: React.FC<{
  selectionMode: SelectionMode;
  onMapClick?: (coordinates: Coordinates) => void;
}> = ({ selectionMode, onMapClick }) => {
  useMapEvents({
    click: (e) => {
      if (selectionMode && onMapClick) {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
  });
  return null;
};

// Component to handle map center changes
const MapCenterHandler: React.FC<{
  center: Coordinates;
}> = ({ center }) => {
  const map = useMap();
  const lastCenter = useRef<Coordinates>(center);

  useEffect(() => {
    if (
      center.lat !== lastCenter.current.lat ||
      center.lng !== lastCenter.current.lng
    ) {
      map.setView([center.lat, center.lng], map.getZoom());
      lastCenter.current = center;
    }
  }, [center, map]);

  return null;
};

const MapView: React.FC<MapViewProps> = ({
  center,
  zoom = 11,
  depot,
  targets = [],
  selectionMode,
  onMapClick,
  pendingMarker,
  style,
}) => {
  const markers: MarkerData[] = [];

  // Add depot marker
  if (depot) {
    markers.push({
      id: 'depot',
      type: 'depot',
      coordinates: depot.coordinates,
      address: depot,
      label: 'Depot',
    });
  }

  // Add target markers
  targets.forEach((target, index) => {
    markers.push({
      id: `target-${index}`,
      type: 'target',
      coordinates: target.coordinates,
      address: target,
      label: target.label || `Target ${index + 1}`,
    });
  });

  // Add pending marker
  if (pendingMarker) {
    markers.push({
      id: 'pending',
      type: 'pending',
      coordinates: pendingMarker,
      label: selectionMode === 'depot' ? 'New Depot' : 'New Target',
    });
  }

  const getIcon = (type: MarkerData['type']) => {
    switch (type) {
      case 'depot':
        return depotIcon;
      case 'target':
        return targetIcon;
      case 'pending':
        return pendingIcon;
    }
  };

  return (
    <div style={{ ...styles.container, ...style }}>
      {selectionMode && (
        <div style={styles.selectionBanner}>
          Click on the map to select {selectionMode === 'depot' ? 'depot' : 'target'} location
        </div>
      )}
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={styles.map}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler selectionMode={selectionMode} onMapClick={onMapClick} />
        <MapCenterHandler center={center} />

        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.coordinates.lat, marker.coordinates.lng]}
            icon={getIcon(marker.type)}
          >
            <Popup>
              <div style={styles.popup}>
                <strong>{marker.label}</strong>
                {marker.address && (
                  <p style={styles.popupAddress}>{marker.address.formattedAddress}</p>
                )}
                {!marker.address && (
                  <p style={styles.popupCoords}>
                    {marker.coordinates.lat.toFixed(5)}, {marker.coordinates.lng.toFixed(5)}
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, backgroundColor: '#2AAD27' }} />
          <span>Depot</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, backgroundColor: '#2A81CB' }} />
          <span>Target</span>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '100%',
    height: '400px',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid #e5e7eb',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  selectionBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    background: 'rgba(37, 99, 235, 0.9)',
    color: '#fff',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 500,
    textAlign: 'center',
    zIndex: 1000,
  },
  legend: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    background: 'rgba(255, 255, 255, 0.95)',
    padding: '8px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    zIndex: 1000,
    display: 'flex',
    gap: '12px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  legendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  popup: {
    minWidth: '150px',
  },
  popupAddress: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: '#666',
  },
  popupCoords: {
    margin: '4px 0 0 0',
    fontSize: '11px',
    color: '#999',
    fontFamily: 'monospace',
  },
};

export default MapView;
