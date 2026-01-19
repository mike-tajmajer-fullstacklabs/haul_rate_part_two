import React, { useState } from 'react';
import { api, DeliveryPlan, OptimizeRequest } from './api/client';
import DeliveryForm from './components/DeliveryForm';
import ResultsPanel from './components/ResultsPanel';

const App: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<DeliveryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOptimize = async (request: OptimizeRequest) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.optimize(request);

      if (response.success && response.plan) {
        setPlan(response.plan);
      } else {
        setError(response.error || 'Unknown error occurred');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize delivery');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>Traffic Density Forecasting</h1>
        <p style={styles.subtitle}>
          Optimize delivery order based on predicted traffic conditions
        </p>
      </header>

      <main style={styles.main}>
        <div style={styles.formSection}>
          <DeliveryForm onSubmit={handleOptimize} loading={loading} />
        </div>

        <div style={styles.resultsSection}>
          <ResultsPanel plan={plan} error={error} />
        </div>
      </main>

      <footer style={styles.footer}>
        <p>Traffic data powered by TomTom</p>
      </footer>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#f5f5f5',
  },
  header: {
    background: '#1e3a5f',
    color: '#fff',
    padding: '24px 32px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    margin: 0,
    marginBottom: '4px',
  },
  subtitle: {
    fontSize: '14px',
    opacity: 0.8,
    margin: 0,
  },
  main: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '400px 1fr',
    gap: '24px',
    padding: '24px 32px',
    maxWidth: '1400px',
    margin: '0 auto',
    width: '100%',
  },
  formSection: {
    minWidth: '350px',
  },
  resultsSection: {
    minWidth: '400px',
  },
  footer: {
    textAlign: 'center',
    padding: '16px',
    color: '#6b7280',
    fontSize: '12px',
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
  },
};

// Responsive styles for smaller screens
if (typeof window !== 'undefined' && window.innerWidth < 900) {
  styles.main = {
    ...styles.main,
    gridTemplateColumns: '1fr',
  };
}

export default App;
