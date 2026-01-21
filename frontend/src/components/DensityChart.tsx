import React from 'react';
import { OptimizedDelivery } from '../api/client';

interface DensityChartProps {
  deliveries: OptimizedDelivery[];
  averageTrafficDensity?: number;
}

const getDensityColor = (density: number): string => {
  if (density < 1.1) return '#22c55e'; // Green
  if (density < 1.3) return '#eab308'; // Yellow
  if (density < 1.5) return '#f97316'; // Orange
  return '#ef4444'; // Red
};

const DensityChart: React.FC<DensityChartProps> = ({ deliveries, averageTrafficDensity }) => {
  if (deliveries.length === 0) return null;

  // Calculate average if not provided
  const avgDensity = averageTrafficDensity ??
    deliveries.reduce((sum, d) => sum + d.roundTripTrafficDensity, 0) / deliveries.length;

  const maxDensity = Math.max(
    2, // Minimum scale
    avgDensity + 0.2, // Ensure average line is visible
    ...deliveries.map((d) => d.roundTripTrafficDensity)
  );

  const chartHeight = 120;
  const barWidth = Math.min(40, (300 - deliveries.length * 4) / deliveries.length);

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Round-Trip Traffic Density by Delivery</h3>
      <div style={styles.chartArea}>
        {/* Y-axis labels - exactly chartHeight tall */}
        <div style={{ ...styles.yAxis, height: `${chartHeight}px` }}>
          <span style={styles.yLabel}>{maxDensity.toFixed(2)}</span>
          <span style={styles.yLabel}>{((1 + maxDensity) / 2).toFixed(2)}</span>
          <span style={styles.yLabel}>1.00</span>
        </div>

        {/* Chart content area */}
        <div style={styles.chartContent}>
          {/* Bars area - exactly chartHeight tall, aligned with Y-axis */}
          <div style={{ ...styles.barsArea, height: `${chartHeight}px` }}>
            {/* Grid lines at fixed density values */}
            {[1.0, 1.25, 1.5, 1.75, 2.0]
              .filter((density) => density <= maxDensity)
              .map((density) => (
                <div
                  key={`grid-${density}`}
                  style={{
                    ...styles.gridLine,
                    bottom: `${((density - 1) / (maxDensity - 1)) * chartHeight}px`,
                  }}
                />
              ))}

            {/* Average density line */}
            <div
              style={{
                ...styles.averageLine,
                bottom: `${((avgDensity - 1) / (maxDensity - 1)) * chartHeight}px`,
              }}
            >
              <span style={styles.averageLabel}>Avg: {avgDensity.toFixed(2)}</span>
            </div>

            {deliveries.map((delivery) => {
              const density = delivery.roundTripTrafficDensity;
              // Scale bar height from 1.0 (bottom) to maxDensity (top)
              // Ensure minimum height of 20px for visibility
              const barHeight = Math.max(20, ((density - 1) / (maxDensity - 1)) * chartHeight);

              return (
                <div
                  key={delivery.route.id}
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
              );
            })}
          </div>

          {/* X-axis labels - separate row below the bars */}
          <div style={styles.xAxisLabels}>
            {deliveries.map((delivery) => (
              <span
                key={delivery.route.id}
                style={{ ...styles.barLabel, width: `${barWidth}px` }}
              >
                {delivery.order}
              </span>
            ))}
          </div>
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
    gap: '8px',
  },
  yAxis: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    width: '40px',
  },
  yLabel: {
    fontSize: '10px',
    color: '#6b7280',
    textAlign: 'right',
  },
  chartContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  barsArea: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: '8px',
    position: 'relative',
    borderBottom: '1px solid #e5e7eb',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '1px',
    background: '#000',
    opacity: 0.15,
    pointerEvents: 'none',
  },
  averageLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '2px',
    background: '#2563eb',
    zIndex: 1,
  },
  averageLabel: {
    position: 'absolute',
    right: '0',
    top: '-16px',
    fontSize: '10px',
    fontWeight: 600,
    color: '#2563eb',
    background: '#f9fafb',
    padding: '1px 4px',
    borderRadius: '2px',
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
  xAxisLabels: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    paddingTop: '4px',
  },
  barLabel: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#6b7280',
    textAlign: 'center',
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
