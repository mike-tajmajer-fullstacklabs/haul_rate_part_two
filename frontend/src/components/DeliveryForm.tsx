import React, { useState, useCallback } from 'react';
import { api, AddressInput, Coordinates, GeocodedAddress, OptimizeRequest, LocationSearchResult } from '../api/client';
import AddressList from './AddressList';
import MapView, { SelectionMode } from './MapView';
import LocationSearch from './LocationSearch';

interface DeliveryFormProps {
  onSubmit: (request: OptimizeRequest) => void;
  loading: boolean;
}

// Los Angeles, CA default coordinates
const DEFAULT_CENTER: Coordinates = { lat: 34.0522, lng: -118.2437 };
const DEFAULT_ZOOM = 11;

type InputMode = 'text' | 'map';

interface TargetAddress {
  input: AddressInput;
  geocoded?: GeocodedAddress;
}

const DeliveryForm: React.FC<DeliveryFormProps> = ({ onSubmit, loading }) => {
  // Map state
  const [mapCenter, setMapCenter] = useState<Coordinates>(DEFAULT_CENTER);
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(null);
  const [pendingMarker, setPendingMarker] = useState<Coordinates | null>(null);

  // Depot state
  const [depotInput, setDepotInput] = useState<AddressInput>({ address: '', label: 'Depot' });
  const [depotGeocoded, setDepotGeocoded] = useState<GeocodedAddress | null>(null);

  // Targets state
  const [targets, setTargets] = useState<TargetAddress[]>([{ input: { address: '', label: '' } }]);

  // Schedule state
  const [departureTime, setDepartureTime] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30);
    now.setSeconds(0);
    now.setMilliseconds(0);
    return now.toISOString().slice(0, 16);
  });
  const [deliveryDuration, setDeliveryDuration] = useState(15);

  // Processing state
  const [geocodingPending, setGeocodingPending] = useState(false);

  const handleLocationSearchSelect = useCallback((result: LocationSearchResult) => {
    setMapCenter(result.coordinates);
  }, []);

  const handleMapClick = useCallback(async (coordinates: Coordinates) => {
    if (!selectionMode) return;

    setPendingMarker(coordinates);
    setGeocodingPending(true);

    try {
      const response = await api.reverseGeocode(coordinates);
      if (response.success && response.address) {
        if (selectionMode === 'depot') {
          setDepotInput({ address: response.address.address, label: 'Depot' });
          setDepotGeocoded(response.address);
        } else if (selectionMode === 'target') {
          const newTarget: TargetAddress = {
            input: { address: response.address.address, label: '' },
            geocoded: response.address,
          };
          setTargets((prev) => {
            // Replace empty targets or add new one
            const emptyIndex = prev.findIndex((t) => !t.input.address.trim());
            if (emptyIndex >= 0) {
              const updated = [...prev];
              updated[emptyIndex] = newTarget;
              return updated;
            }
            return [...prev, newTarget];
          });
        }
      }
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
    } finally {
      setPendingMarker(null);
      setGeocodingPending(false);
      setSelectionMode(null);
    }
  }, [selectionMode]);

  const handleAddTarget = () => {
    setTargets([...targets, { input: { address: '', label: '' } }]);
  };

  const handleRemoveTarget = (index: number) => {
    if (targets.length > 1) {
      setTargets(targets.filter((_, i) => i !== index));
    }
  };

  const handleTargetChange = (index: number, field: 'address' | 'label', value: string) => {
    const updated = [...targets];
    updated[index] = {
      ...updated[index],
      input: { ...updated[index].input, [field]: value },
      // Clear geocoded if address changes
      geocoded: field === 'address' ? undefined : updated[index].geocoded,
    };
    setTargets(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validTargets = targets
      .filter((t) => t.input.address.trim())
      .map((t) => t.input);

    if (!depotInput.address.trim() || validTargets.length === 0) {
      return;
    }

    const request: OptimizeRequest = {
      depot: depotInput,
      targets: validTargets,
      firstDepartureTime: new Date(departureTime).toISOString(),
      deliveryDurationMinutes: deliveryDuration,
    };

    onSubmit(request);
  };

  const isValid = depotInput.address.trim() && targets.some((t) => t.input.address.trim());

  // Get geocoded targets for map display
  const geocodedTargets = targets
    .filter((t) => t.geocoded)
    .map((t) => t.geocoded as GeocodedAddress);

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {/* Input mode toggle */}
      <div style={styles.modeToggle}>
        <button
          type="button"
          style={{
            ...styles.modeButton,
            ...(inputMode === 'text' ? styles.modeButtonActive : {}),
          }}
          onClick={() => setInputMode('text')}
        >
          Text Input
        </button>
        <button
          type="button"
          style={{
            ...styles.modeButton,
            ...(inputMode === 'map' ? styles.modeButtonActive : {}),
          }}
          onClick={() => setInputMode('map')}
        >
          Map Selection
        </button>
      </div>

      {inputMode === 'map' && (
        <>
          {/* Location search */}
          <div style={styles.searchSection}>
            <label style={styles.label}>Search Location to Center Map</label>
            <LocationSearch
              onLocationSelect={handleLocationSearchSelect}
              placeholder="Search for a city or address..."
              center={mapCenter}
              disabled={loading}
            />
          </div>

          {/* Map view */}
          <div style={styles.mapSection}>
            <MapView
              center={mapCenter}
              zoom={DEFAULT_ZOOM}
              depot={depotGeocoded}
              targets={geocodedTargets}
              selectionMode={selectionMode}
              onMapClick={handleMapClick}
              pendingMarker={pendingMarker}
              style={{ height: '350px' }}
            />

            {/* Map action buttons */}
            <div style={styles.mapActions}>
              <button
                type="button"
                style={{
                  ...styles.mapActionButton,
                  ...(selectionMode === 'depot' ? styles.mapActionButtonActive : {}),
                  ...(loading || geocodingPending ? styles.mapActionButtonDisabled : {}),
                }}
                onClick={() => setSelectionMode(selectionMode === 'depot' ? null : 'depot')}
                disabled={loading || geocodingPending}
              >
                {selectionMode === 'depot' ? 'Cancel' : 'Set Depot'}
              </button>
              <button
                type="button"
                style={{
                  ...styles.mapActionButton,
                  ...(selectionMode === 'target' ? styles.mapActionButtonActive : {}),
                  ...(loading || geocodingPending ? styles.mapActionButtonDisabled : {}),
                }}
                onClick={() => setSelectionMode(selectionMode === 'target' ? null : 'target')}
                disabled={loading || geocodingPending}
              >
                {selectionMode === 'target' ? 'Cancel' : 'Add Target'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Depot section */}
      <h2 style={styles.sectionTitle}>Depot</h2>
      <div style={styles.depotSection}>
        <div style={styles.depotRow}>
          <input
            type="text"
            placeholder="Depot address (e.g., 123 Main St, City, State)"
            value={depotInput.address}
            onChange={(e) => {
              setDepotInput({ ...depotInput, address: e.target.value });
              setDepotGeocoded(null);
            }}
            style={styles.depotInput}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => {
              setDepotInput({ address: '', label: 'Depot' });
              setDepotGeocoded(null);
            }}
            style={{
              ...styles.clearButton,
              ...(!depotInput.address.trim() || loading ? styles.clearButtonDisabled : {}),
            }}
            disabled={!depotInput.address.trim() || loading}
            title="Clear depot"
          >
            &times;
          </button>
        </div>
        {depotGeocoded && (
          <div style={styles.geocodedBadge}>
            Verified: {depotGeocoded.formattedAddress}
          </div>
        )}
      </div>

      {/* Targets section */}
      <h2 style={styles.sectionTitle}>Delivery Targets</h2>
      <AddressList
        addresses={targets.map((t) => t.input)}
        onChange={handleTargetChange}
        onRemove={handleRemoveTarget}
        onAdd={handleAddTarget}
        disabled={loading}
      />
      {targets.some((t) => t.geocoded) && (
        <div style={styles.geocodedList}>
          {targets.map((t, i) =>
            t.geocoded ? (
              <div key={i} style={styles.geocodedItem}>
                Target {i + 1}: {t.geocoded.formattedAddress}
              </div>
            ) : null
          )}
        </div>
      )}

      {/* Schedule section */}
      <h2 style={styles.sectionTitle}>Schedule</h2>
      <div style={styles.scheduleSection}>
        <div style={styles.field}>
          <label style={styles.label}>First Departure Time</label>
          <input
            type="datetime-local"
            value={departureTime}
            onChange={(e) => setDepartureTime(e.target.value)}
            style={styles.input}
            disabled={loading}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Delivery (unloading) duration (min)</label>
          <input
            type="number"
            min={5}
            max={120}
            value={deliveryDuration}
            onChange={(e) => setDeliveryDuration(parseInt(e.target.value) || 15)}
            style={styles.input}
            disabled={loading}
          />
        </div>
      </div>

      <button
        type="submit"
        style={{
          ...styles.submitButton,
          ...(loading || !isValid ? styles.submitButtonDisabled : {}),
        }}
        disabled={loading || !isValid}
      >
        {loading ? 'Optimizing...' : 'Optimize Delivery Order'}
      </button>
    </form>
  );
};

const styles: Record<string, React.CSSProperties> = {
  form: {
    background: '#fff',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  modeToggle: {
    display: 'flex',
    gap: '8px',
    marginBottom: '20px',
    padding: '4px',
    background: '#f3f4f6',
    borderRadius: '6px',
  },
  modeButton: {
    flex: 1,
    padding: '10px 16px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: '#6b7280',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  modeButtonActive: {
    background: '#fff',
    color: '#111827',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  searchSection: {
    marginBottom: '16px',
  },
  mapSection: {
    marginBottom: '20px',
  },
  mapActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
  },
  mapActionButton: {
    flex: 1,
    padding: '10px 16px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    color: '#374151',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  mapActionButtonActive: {
    background: '#2563eb',
    color: '#fff',
    borderColor: '#2563eb',
  },
  mapActionButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '12px',
    marginTop: '16px',
    color: '#333',
  },
  depotSection: {
    marginBottom: '16px',
  },
  depotRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
  },
  depotInput: {
    flex: 1,
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  clearButton: {
    width: '42px',
    height: '42px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fee2e2',
    color: '#dc2626',
    border: 'none',
    borderRadius: '4px',
    fontSize: '20px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  clearButtonDisabled: {
    background: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'not-allowed',
  },
  input: {
    width: '100%',
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    marginBottom: '8px',
    boxSizing: 'border-box',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    marginBottom: '4px',
    color: '#666',
    display: 'block',
  },
  geocodedBadge: {
    padding: '8px 12px',
    background: '#f0fdf4',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#16a34a',
    border: '1px solid #bbf7d0',
  },
  geocodedList: {
    marginTop: '8px',
    padding: '8px 12px',
    background: '#f0fdf4',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#16a34a',
    border: '1px solid #bbf7d0',
  },
  geocodedItem: {
    padding: '4px 0',
  },
  scheduleSection: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    marginBottom: '24px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
  },
  submitButton: {
    width: '100%',
    padding: '14px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  submitButtonDisabled: {
    background: '#9ca3af',
    cursor: 'not-allowed',
  },
};

export default DeliveryForm;
