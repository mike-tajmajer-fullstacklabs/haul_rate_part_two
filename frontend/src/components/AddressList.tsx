import React from 'react';
import { AddressInput } from '../api/client';

interface AddressListProps {
  addresses: AddressInput[];
  onChange: (index: number, field: 'address' | 'label', value: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  disabled: boolean;
}

const AddressList: React.FC<AddressListProps> = ({
  addresses,
  onChange,
  onRemove,
  onAdd,
  disabled,
}) => {
  return (
    <div style={styles.container}>
      {addresses.map((addr, index) => (
        <div key={index} style={styles.row}>
          <div style={styles.number}>{index + 1}</div>
          <div style={styles.inputs}>
            <input
              type="text"
              placeholder={`Target address ${index + 1}`}
              value={addr.address}
              onChange={(e) => onChange(index, 'address', e.target.value)}
              style={styles.addressInput}
              disabled={disabled}
            />
            <input
              type="text"
              placeholder="Label (optional)"
              value={addr.label || ''}
              onChange={(e) => onChange(index, 'label', e.target.value)}
              style={styles.labelInput}
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            onClick={() => onRemove(index)}
            style={{
              ...styles.removeButton,
              ...(addresses.length <= 1 || disabled ? styles.removeButtonDisabled : {}),
            }}
            disabled={addresses.length <= 1 || disabled}
            title="Remove target"
          >
            &times;
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        style={{
          ...styles.addButton,
          ...(disabled ? styles.addButtonDisabled : {}),
        }}
        disabled={disabled}
      >
        + Add Target
      </button>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '16px',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    marginBottom: '8px',
    width: '100%',
  },
  number: {
    width: '24px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#e5e7eb',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    flexShrink: 0,
  },
  inputs: {
    flex: 1,
    display: 'flex',
    gap: '8px',
    minWidth: 0,
  },
  addressInput: {
    flex: 2,
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    minWidth: 0,
    boxSizing: 'border-box' as const,
  },
  labelInput: {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    minWidth: 0,
    boxSizing: 'border-box' as const,
  },
  removeButton: {
    width: '40px',
    height: '40px',
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
  removeButtonDisabled: {
    background: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'not-allowed',
  },
  addButton: {
    padding: '10px 16px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px dashed #d1d5db',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    width: '100%',
  },
  addButtonDisabled: {
    color: '#9ca3af',
    cursor: 'not-allowed',
  },
};

export default AddressList;
