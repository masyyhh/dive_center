import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Property } from '../types';
import { useAuth } from './AuthContext';
import { apiFetch, getStoredPropertyId, setStoredPropertyId } from '../services/api';

interface PropertyContextType {
  properties: Property[];
  activeProperty: Property | null;
  loading: boolean;
  error: string;
  canSwitchProperty: boolean;
  setActiveProperty: (property: Property) => void;
  refreshProperties: () => Promise<void>;
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined);

export const PropertyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [activeProperty, setActivePropertyState] = useState<Property | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<boolean>(true);

  const canSwitchProperty = Boolean(
    user && (user.role === 'GLOBAL_ADMIN' || (user.role === 'PROPERTY_MANAGER' && properties.length > 1))
  );

  const propertyRequest = useRef(0);
  const refreshProperties = async () => {
    const request = ++propertyRequest.current;
    setError('');
    if (!user || !user.authenticatorEnabled) {
      setProperties([]);
      setActivePropertyState(null);
      setStoredPropertyId(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await apiFetch<{ properties: Property[] }>('/properties');
      if (request !== propertyRequest.current) return;
      setProperties(data.properties);

      // Check stored property
      const storedId = getStoredPropertyId();
      let matched = data.properties.find((p) => p.id === storedId);

      // If user is CENTRE_STAFF, always enforce their assigned property
      if (user.role === 'CENTRE_STAFF' && user.assignedProperties.length > 0) {
        matched = data.properties.find((p) => p.id === user.assignedProperties[0].id) || data.properties[0];
      }

      if (!matched && data.properties.length > 0) {
        matched = data.properties[0];
      }

      setActivePropertyState(matched || null);
      setStoredPropertyId(matched?.id || null);
    } catch (err) {
      if (request === propertyRequest.current) { console.error('Failed to load properties:', err); setError(err instanceof Error ? err.message : 'Could not load properties.'); }
    } finally {
      if (request === propertyRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    setProperties([]); setActivePropertyState(null);
    refreshProperties();
    return () => { propertyRequest.current++; };
  }, [user]);

  const setActiveProperty = (property: Property) => {
    if (!canSwitchProperty && user?.role === 'CENTRE_STAFF') {
      return; // Locked for centre staff per manual
    }
    setActivePropertyState(property);
    setStoredPropertyId(property.id);
  };

  return (
    <PropertyContext.Provider
      value={{
        properties,
        activeProperty,
        loading,
        error,
        canSwitchProperty,
        setActiveProperty,
        refreshProperties,
      }}
    >
      {children}
    </PropertyContext.Provider>
  );
};

export const useProperty = () => {
  const context = useContext(PropertyContext);
  if (!context) throw new Error('useProperty must be used within a PropertyProvider');
  return context;
};
