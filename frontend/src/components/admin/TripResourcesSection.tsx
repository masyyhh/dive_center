import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { useNavigation, useUnsavedChanges } from '../../context/NavigationContext';
import type { TankResource, TankSetup } from '../../types/tank';

const normalizeName = (value: string) => value.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
export function TripResourcesSection({ propertyId, onChanged }: { propertyId: string; onChanged: () => void }) {
  const [resources, setResources] = useState<TankResource[]>([]);
  const [kind, setKind] = useState<'BOAT' | 'SITE'>('BOAT');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const { requestNavigation } = useNavigation();
  useUnsavedChanges(!!name.trim(), 'You have unsaved boat or dive-site details.', busy);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError('');
    apiFetch<TankSetup>(`/tank-commission/setup?${new URLSearchParams({ propertyId })}`)
      .then((data) => {
        if (current) setResources(data.resources);
      })
      .catch((error) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : 'Could not load boats and dive sites.',
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [propertyId, revision]);
  const boats = resources.filter((row) => row.kind === 'BOAT');
  const sites = resources.filter((row) => row.kind === 'SITE');
  const category = kind === 'BOAT' ? boats : sites;
  const label = kind === 'BOAT' ? 'Dhoni' : 'dive site';
  const title = kind === 'BOAT' ? 'Dhonis & boats' : 'Dive sites';
  const duplicate = name.trim()
    ? category.find((row) => normalizeName(row.name) === normalizeName(name))
    : undefined;
  const visible = category
    .filter(
      (row) =>
        normalizeName(row.name).includes(normalizeName(query)) &&
        (availability === 'ALL' || row.isActive === (availability === 'ACTIVE')),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectKind = (next: typeof kind) => {
    if (next === kind) return;
    requestNavigation(() => {
      setKind(next);
      setName('');
      setQuery('');
      setAvailability('ALL');
      setError('');
      setNotice('');
    });
  };
  const save = async (endpoint: string, method: string, values: object, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiFetch<{ resource: TankResource }>(`/tank-commission/${endpoint}`, {
        method,
        body: JSON.stringify({ propertyId, ...values }),
      });
      if (result.resource)
        setResources((rows) => [
          ...rows.filter((row) => row.id !== result.resource.id),
          result.resource,
        ]);
      else setRevision((value) => value + 1);
      if (method === 'POST') {
        setName('');
        setQuery('');
        setAvailability('ALL');
      }
      setNotice(message);
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save boat or dive site.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="trip-resources space-y-5">
      <div className="resource-heading">
        <div>
          <h2 className="text-lg font-bold">Boats & sites</h2>
          <p>Add the Dhonis and dive sites your team selects when logging a trip.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      <div className="admin-tabs resource-categories" role="group" aria-label="Resource category">
        {(
          [
            { kind: 'BOAT', title: 'Dhonis & boats', rows: boats },
            { kind: 'SITE', title: 'Dive sites', rows: sites },
          ] as const
        ).map((category) => (
          <button
            type="button"
            key={category.kind}
            className="resource-category"
            aria-pressed={kind === category.kind}
            disabled={busy}
            onClick={() => selectKind(category.kind)}
          >
            <span>{category.title}</span>
            <small>
              {loading && !resources.length
                ? 'Loading…'
                : loadError && !resources.length
                  ? 'Unavailable'
                  : `${category.rows.filter((row) => row.isActive).length} available · ${category.rows.length} total`}
            </small>
          </button>
        ))}
      </div>
      {loadError && (
        <div className="notice notice-error" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="text-button"
            disabled={busy || loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice notice-success" role="status">
          {notice}
        </p>
      )}
      <div className="resource-add-card surface">
        <div>
          <h3>Add {kind === 'BOAT' ? 'a Dhoni' : 'a dive site'}</h3>
          <p>Available in new trip logs as soon as you add it.</p>
        </div>
        <form
          className="resource-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || duplicate) return;
            void save(
              'resources',
              'POST',
              { kind, name: name.trim() },
              `${name.trim()} added and available for new trips.`,
            );
          }}
        >
          <div className="resource-name-field">
            <label htmlFor="trip-resource-name">
              {kind === 'BOAT' ? 'Dhoni name' : 'Dive site name'}
            </label>
            <input
              id="trip-resource-name"
              required
              maxLength={100}
              value={name}
              disabled={busy || loading || !!loadError}
              placeholder={kind === 'BOAT' ? 'e.g. Blue Dhoni' : 'e.g. Banana Reef'}
              aria-invalid={!!duplicate}
              aria-describedby={duplicate ? 'resource-name-error' : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            className="primary-button"
            disabled={busy || loading || !!loadError || !name.trim() || !!duplicate}
          >
            {busy ? 'Saving…' : `Add ${kind === 'BOAT' ? 'Dhoni' : 'dive site'}`}
          </button>
        </form>
        {duplicate && (
          <p id="resource-name-error" className="field-error">
            {duplicate.name} already exists.
            {!duplicate.isActive && (
              <>
                {' '}
                It is inactive.{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setQuery(duplicate.name);
                    setAvailability('INACTIVE');
                  }}
                >
                  Find it below to make it available
                </button>
              </>
            )}
          </p>
        )}
      </div>
      <div className="resource-list-card surface" aria-busy={loading || busy}>
        <div className="resource-list-heading">
          <div>
            <h3>{title}</h3>
            <p>
              Turn availability off to hide an entry from new trips. Previous trip logs keep their
              details.
            </p>
          </div>
          <span className="resource-result-count" role="status">
            {visible.length} of {category.length} shown
          </span>
        </div>
        <div className="resource-list-tools">
          <div className="resource-search">
            <label htmlFor="trip-resource-search" className="sr-only">
              Search {title}
            </label>
            <input
              id="trip-resource-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={kind === 'BOAT' ? 'Search Dhonis…' : 'Search dive sites…'}
            />
          </div>
          <label className="resource-filter">
            Show
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value as typeof availability)}
            >
              <option value="ALL">All ({category.length})</option>
              <option value="ACTIVE">
                Available ({category.filter((row) => row.isActive).length})
              </option>
              <option value="INACTIVE">
                Inactive ({category.filter((row) => !row.isActive).length})
              </option>
            </select>
          </label>
        </div>
        {loading && !resources.length ? (
          <p className="resource-empty" role="status">
            Loading boats and sites…
          </p>
        ) : (
          <>
            {!!visible.length && (
              <div className="resource-column-head">
                <span>Name</span>
                <span>Available for new trips</span>
              </div>
            )}
            <ul className="resource-list">
              {visible.map((resource) => (
                <li
                  key={resource.id}
                  className={`resource-row${resource.isActive ? '' : ' is-inactive'}`}
                >
                  <div className="resource-row-name">
                    <div>
                      <strong>{resource.name}</strong>
                      <span>
                        {resource.isActive
                          ? 'Available in trip dropdowns'
                          : 'Inactive · hidden from new trips'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={resource.isActive}
                    aria-label={`${resource.name}: available for new trips`}
                    className="resource-switch"
                    disabled={busy || loading || !!loadError}
                    onClick={() => {
                      void save(
                        `resources/${resource.id}`,
                        'PUT',
                        { isActive: !resource.isActive },
                        resource.isActive
                          ? `${resource.name} hidden from new trips.`
                          : `${resource.name} is now available for new trips.`,
                      );
                    }}
                  >
                    <span />
                  </button>
                </li>
              ))}
            </ul>
            {!visible.length && !loadError && (
              <div className="resource-empty">
                <strong>{category.length ? 'No matches found' : `Add your first ${label}`}</strong>
                <p>
                  {category.length
                    ? 'Try a different name or availability filter.'
                    : `Use the form above to make this ${label} available to your team.`}
                </p>
                {category.length > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setQuery('');
                      setAvailability('ALL');
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
