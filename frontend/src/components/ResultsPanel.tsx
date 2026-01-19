import React from 'react';
import { DeliveryPlan, OptimizedDelivery } from '../api/client';
import DensityChart from './DensityChart';

interface ResultsPanelProps {
  plan: DeliveryPlan | null;
  error: string | null;
}

const formatTime = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatDistance = (meters: number): string => {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
};

const getDensityColor = (density: number): string => {
  if (density < 1.1) return '#22c55e'; // Green - free flow
  if (density < 1.3) return '#eab308'; // Yellow - light traffic
  if (density < 1.5) return '#f97316'; // Orange - moderate traffic
  return '#ef4444'; // Red - heavy traffic
};

const getDensityLabel = (density: number): string => {
  if (density < 1.1) return 'Free Flow';
  if (density < 1.3) return 'Light Traffic';
  if (density < 1.5) return 'Moderate Traffic';
  return 'Heavy Traffic';
};

const ResultsPanel: React.FC<ResultsPanelProps> = ({ plan, error }) => {
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBox}>
          <h3 style={styles.errorTitle}>Optimization Failed</h3>
          <p style={styles.errorMessage}>{error}</p>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div style={styles.container}>
        <div style={styles.placeholder}>
          <p style={styles.placeholderText}>
            Enter a depot address and delivery targets, then click "Optimize" to see
            the optimal delivery order based on traffic density forecasts.
          </p>
        </div>
      </div>
    );
  }

  const dayTypeLabels: Record<string, string> = {
    weekday: 'Weekday',
    weekend: 'Weekend',
    holiday: 'Holiday',
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Optimized Delivery Plan</h2>
        <span style={styles.dayTypeBadge}>{dayTypeLabels[plan.dayType]}</span>
      </div>

      <div style={styles.summary}>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>Total Distance</span>
          <span style={styles.summaryValue}>{formatDistance(plan.totalDistanceMeters)}</span>
        </div>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>Total Travel Time</span>
          <span style={styles.summaryValue}>{formatDuration(plan.totalTravelTimeSeconds)}</span>
        </div>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>Avg Density</span>
          <span
            style={{
              ...styles.summaryValue,
              color: getDensityColor(plan.averageTrafficDensity),
            }}
          >
            {plan.averageTrafficDensity.toFixed(2)}
          </span>
        </div>
      </div>

      <DensityChart deliveries={plan.deliveries} />

      <div style={styles.depotInfo}>
        <div style={styles.depotIcon}>D</div>
        <div style={styles.depotDetails}>
          <span style={styles.depotLabel}>Depot</span>
          <span style={styles.depotAddress}>{plan.depot.formattedAddress}</span>
        </div>
      </div>

      <div style={styles.deliveriesList}>
        {plan.deliveries.map((delivery) => (
          <DeliveryCard key={delivery.route.id} delivery={delivery} />
        ))}
      </div>
    </div>
  );
};

const DeliveryCard: React.FC<{ delivery: OptimizedDelivery }> = ({ delivery }) => {
  const roundTripDensity = delivery.roundTripTrafficDensity;
  const roundTripDistance = delivery.route.distanceMeters + delivery.returnRoute.distanceMeters;
  const roundTripTime = delivery.route.travelTimeSeconds + delivery.returnRoute.travelTimeSeconds;

  return (
    <div style={styles.deliveryCard}>
      <div style={styles.deliveryHeader}>
        <div style={styles.orderNumber}>{delivery.order}</div>
        <div style={styles.deliveryTimes}>
          <span style={styles.timeLabel}>Depart</span>
          <span style={styles.timeValue}>{formatTime(delivery.estimatedDepartureTime)}</span>
          <span style={styles.timeSeparator}>→</span>
          <span style={styles.timeLabel}>Return</span>
          <span style={styles.timeValue}>{formatTime(delivery.estimatedReturnTime)}</span>
        </div>
        <div
          style={{
            ...styles.densityBadge,
            backgroundColor: getDensityColor(roundTripDensity),
          }}
        >
          {roundTripDensity.toFixed(2)}
        </div>
      </div>

      <div style={styles.deliveryAddress}>
        {delivery.target.address.label && (
          <span style={styles.addressLabel}>{delivery.target.address.label}</span>
        )}
        <span style={styles.addressText}>{delivery.target.address.formattedAddress}</span>
      </div>

      <div style={styles.deliveryStats}>
        <span style={styles.stat}>
          {formatDistance(roundTripDistance)} round trip
        </span>
        <span style={styles.statSeparator}>•</span>
        <span style={styles.stat}>
          {formatDuration(roundTripTime)} travel
        </span>
        <span style={styles.statSeparator}>•</span>
        <span style={styles.stat}>{getDensityLabel(roundTripDensity)}</span>
      </div>

      <div style={styles.routeBreakdown}>
        <span style={styles.routeLeg}>
          Out: {formatDuration(delivery.route.travelTimeSeconds)} ({delivery.route.trafficDensity.toFixed(2)})
        </span>
        <span style={styles.routeLeg}>
          Return: {formatDuration(delivery.returnRoute.travelTimeSeconds)} ({delivery.returnRoute.trafficDensity.toFixed(2)})
        </span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#fff',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    height: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
    margin: 0,
  },
  dayTypeBadge: {
    padding: '4px 12px',
    background: '#e5e7eb',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#4b5563',
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    padding: '16px',
    background: '#f9fafb',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  summaryItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '4px',
  },
  summaryValue: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
  },
  depotInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    background: '#f0fdf4',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  depotIcon: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#22c55e',
    color: '#fff',
    borderRadius: '50%',
    fontWeight: 700,
    fontSize: '14px',
  },
  depotDetails: {
    display: 'flex',
    flexDirection: 'column',
  },
  depotLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#16a34a',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  depotAddress: {
    fontSize: '14px',
    color: '#333',
  },
  deliveriesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  deliveryCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px',
  },
  deliveryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
  },
  orderNumber: {
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#2563eb',
    color: '#fff',
    borderRadius: '50%',
    fontWeight: 700,
    fontSize: '14px',
    flexShrink: 0,
  },
  deliveryTimes: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '13px',
  },
  timeLabel: {
    color: '#6b7280',
  },
  timeValue: {
    fontWeight: 500,
    color: '#333',
  },
  timeSeparator: {
    color: '#d1d5db',
    margin: '0 4px',
  },
  densityBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    flexShrink: 0,
  },
  deliveryAddress: {
    marginBottom: '8px',
  },
  addressLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    marginBottom: '2px',
  },
  addressText: {
    fontSize: '14px',
    color: '#333',
  },
  deliveryStats: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '12px',
    color: '#6b7280',
  },
  stat: {},
  statSeparator: {
    margin: '0 8px',
    color: '#d1d5db',
  },
  routeBreakdown: {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px dashed #e5e7eb',
    fontSize: '11px',
    color: '#9ca3af',
  },
  routeLeg: {},
  errorBox: {
    padding: '20px',
    background: '#fef2f2',
    borderRadius: '8px',
    border: '1px solid #fecaca',
  },
  errorTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#dc2626',
    marginBottom: '8px',
    margin: 0,
  },
  errorMessage: {
    color: '#991b1b',
    margin: 0,
  },
  placeholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '300px',
    background: '#f9fafb',
    borderRadius: '8px',
  },
  placeholderText: {
    textAlign: 'center',
    color: '#6b7280',
    maxWidth: '300px',
  },
};

export default ResultsPanel;
