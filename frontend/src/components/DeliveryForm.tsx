import React, { useState, useCallback, useEffect } from 'react';
import { api, AddressInput, Coordinates, GeocodedAddress, OptimizeRequest, LocationSearchResult, RoutingProvider, GoogleTrafficModel } from '../api/client';
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
  // Provider state
  const [availableProviders, setAvailableProviders] = useState<RoutingProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<RoutingProvider | undefined>(undefined);
  const [googleTrafficModel, setGoogleTrafficModel] = useState<GoogleTrafficModel>('best_guess');

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

  // Fetch available providers on mount
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await api.getProviders();
        if (response.success && response.providers) {
          setAvailableProviders(response.providers);
          if (response.default) {
            setSelectedProvider(response.default);
          }
        }
      } catch (error) {
        console.error('Failed to fetch providers:', error);
      }
    };
    fetchProviders();
  }, []);

  // Schedule state - default to next morning at 6:00 AM (local timezone)
  const [departureTime, setDepartureTime] = useState(() => {
    const now = new Date();
    const nextMorning = new Date(now);
    nextMorning.setHours(6, 0, 0, 0);
    // If it's already past 6 AM today, set to tomorrow at 6 AM
    if (now.getHours() >= 6) {
      nextMorning.setDate(nextMorning.getDate() + 1);
    }
    // Format as local datetime string (YYYY-MM-DDTHH:MM)
    const year = nextMorning.getFullYear();
    const month = String(nextMorning.getMonth() + 1).padStart(2, '0');
    const day = String(nextMorning.getDate()).padStart(2, '0');
    const hours = String(nextMorning.getHours()).padStart(2, '0');
    const minutes = String(nextMorning.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  });
  const [deliveryDuration, setDeliveryDuration] = useState(15);
  const [sortByTrafficDensity, setSortByTrafficDensity] = useState(false);

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
      provider: selectedProvider,
      sortByTrafficDensity,
      googleTrafficModel: selectedProvider === 'google' ? googleTrafficModel : undefined,
    };

    onSubmit(request);
  };

  const isValid = depotInput.address.trim() && targets.some((t) => t.input.address.trim());

  // Get geocoded targets for map display
  const geocodedTargets = targets
    .filter((t) => t.geocoded)
    .map((t) => t.geocoded as GeocodedAddress);

  const providerLabels: Record<RoutingProvider, string> = {
    tomtom: 'TomTom',
    here: 'HERE',
    google: 'Google',
  };

  const trafficModelLabels: Record<GoogleTrafficModel, { label: string; description: string }> = {
    best_guess: { label: 'Best Guess', description: 'Best estimate based on historical and live data' },
    pessimistic: { label: 'Pessimistic', description: 'Longer estimates for worst-case planning' },
    optimistic: { label: 'Optimistic', description: 'Shorter estimates assuming good conditions' },
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {/* Provider selector */}
      {availableProviders.length > 1 && (
        <div style={styles.providerSection}>
          <label style={styles.label}>Routing Provider</label>
          <div style={styles.providerToggle}>
            {availableProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                style={{
                  ...styles.providerButton,
                  ...(selectedProvider === provider ? styles.providerButtonActive : {}),
                }}
                onClick={() => setSelectedProvider(provider)}
                disabled={loading}
              >
                {providerLabels[provider]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Google Traffic Model selector - only show when Google is selected */}
      {selectedProvider === 'google' && (
        <div style={styles.trafficModelSection}>
          <label style={styles.label}>Traffic Model</label>
          <select
            value={googleTrafficModel}
            onChange={(e) => setGoogleTrafficModel(e.target.value as GoogleTrafficModel)}
            style={styles.select}
            disabled={loading}
          >
            {(Object.keys(trafficModelLabels) as GoogleTrafficModel[]).map((model) => (
              <option key={model} value={model}>
                {trafficModelLabels[model].label}
              </option>
            ))}
          </select>
          <p style={styles.trafficModelHint}>
            {trafficModelLabels[googleTrafficModel].description}
          </p>
        </div>
      )}

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

      {/* Options section */}
      <h2 style={styles.sectionTitle}>Options</h2>
      <div style={styles.optionsSection}>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={sortByTrafficDensity}
            onChange={(e) => setSortByTrafficDensity(e.target.checked)}
            style={styles.checkbox}
            disabled={loading}
          />
          <span>Sort routes by traffic density (lowest first)</span>
        </label>
        <p style={styles.optionHint}>
          When disabled, routes are returned in the order entered. When enabled, routes are sorted to prioritize lower traffic conditions.
        </p>
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
  providerSection: {
    marginBottom: '16px',
  },
  providerToggle: {
    display: 'flex',
    gap: '8px',
  },
  providerButton: {
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
  providerButtonActive: {
    background: '#2563eb',
    color: '#fff',
    borderColor: '#2563eb',
  },
  trafficModelSection: {
    marginBottom: '16px',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    color: '#374151',
    fontSize: '14px',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23374151' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
  },
  trafficModelHint: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '6px',
    marginBottom: '0',
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
  optionsSection: {
    marginBottom: '24px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#374151',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  optionHint: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '8px',
    marginLeft: '26px',
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
