import React from 'react';
import { OptimizedDelivery } from '../api/client';

interface DensityChartProps {
  deliveries: OptimizedDelivery[];
}

const getDensityColor = (density: number): string => {
  if (density < 1.1) return '#22c55e'; // Green
  if (density < 1.3) return '#eab308'; // Yellow
  if (density < 1.5) return '#f97316'; // Orange
  return '#ef4444'; // Red
};

const DensityChart: React.FC<DensityChartProps> = ({ deliveries }) => {
  if (deliveries.length === 0) return null;

  const maxDensity = Math.max(
    2, // Minimum scale
    ...deliveries.map((d) => d.roundTripTrafficDensity)
  );

  const chartHeight = 120;
  const barWidth = Math.min(40, (300 - deliveries.length * 4) / deliveries.length);

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Round-Trip Traffic Density by Delivery</h3>
      <div style={styles.chartArea}>
        {/* Y-axis labels */}
        <div style={styles.yAxis}>
          <span style={styles.yLabel}>{maxDensity.toFixed(1)}</span>
          <span style={styles.yLabel}>{(maxDensity / 2).toFixed(1)}</span>
          <span style={styles.yLabel}>1.0</span>
        </div>

        {/* Chart bars */}
        <div style={styles.barsContainer}>
          {/* Reference line at 1.0 (free flow) */}
          <div
            style={{
              ...styles.referenceLine,
              bottom: `${(1 / maxDensity) * chartHeight}px`,
            }}
          />

          {deliveries.map((delivery) => {
            const density = delivery.roundTripTrafficDensity;
            const barHeight = (density / maxDensity) * chartHeight;

            return (
              <div key={delivery.route.id} style={styles.barColumn}>
                <div
                  style={{
                    ...styles.bar,
                    height: `${barHeight}px`,
                    width: `${barWidth}px`,
                    backgroundColor: getDensityColor(density),
                  }}
                  title={`Delivery ${delivery.order}: ${density.toFixed(2)}`}
                >
                  <span style={styles.barValue}>{density.toFixed(2)}</span>
                </div>
                <span style={styles.barLabel}>{delivery.order}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendColor, backgroundColor: '#22c55e' }} />
          <span style={styles.legendText}>Free Flow (&lt;1.1)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendColor, backgroundColor: '#eab308' }} />
          <span style={styles.legendText}>Light (1.1-1.3)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendColor, backgroundColor: '#f97316' }} />
          <span style={styles.legendText}>Moderate (1.3-1.5)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendColor, backgroundColor: '#ef4444' }} />
          <span style={styles.legendText}>Heavy (&gt;1.5)</span>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '20px',
    padding: '16px',
    background: '#f9fafb',
    borderRadius: '8px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151',
    margin: 0,
    marginBottom: '16px',
  },
  chartArea: {
    display: 'flex',
    height: '150px',
    gap: '8px',
  },
  yAxis: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingBottom: '20px',
    width: '32px',
  },
  yLabel: {
    fontSize: '10px',
    color: '#6b7280',
    textAlign: 'right',
  },
  barsContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: '8px',
    position: 'relative',
    paddingBottom: '20px',
    borderBottom: '1px solid #e5e7eb',
  },
  referenceLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '1px',
    background: '#d1d5db',
    borderStyle: 'dashed',
  },
  barColumn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  bar: {
    borderRadius: '4px 4px 0 0',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    transition: 'height 0.3s ease',
    minHeight: '20px',
  },
  barValue: {
    fontSize: '9px',
    color: '#fff',
    fontWeight: 600,
    marginTop: '2px',
  },
  barLabel: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#6b7280',
  },
  legend: {
    display: 'flex',
    justifyContent: 'center',
    gap: '16px',
    marginTop: '12px',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  legendColor: {
    width: '12px',
    height: '12px',
    borderRadius: '2px',
  },
  legendText: {
    fontSize: '10px',
    color: '#6b7280',
  },
};

export default DensityChart;
