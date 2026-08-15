import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MapPin, Pencil, Plus, ShieldCheck, Users } from 'lucide-react';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import DataTable, { type Column } from '@/components/common/DataTable';
import PersonAvatar from '@/components/workspace/PersonAvatar';
import StatusPill from '@/components/workspace/StatusPill';
import FindField from '@/components/workspace/FindField';
import SelectMenu from '@/components/workspace/SelectMenu';
import OperationsState from '../Manager/OperationsState';
import { useGetLocations } from '../Location/queries';
import { useGetManagers } from './queries';
import ManagerFormDialog from './ManagerFormDialog';
import ManagerAccessActions from './ManagerAccessActions';
import type { LocationWithCounts } from '../Location/types';
import type { Manager } from './types';
import './managers-v6.css';

const denied = (error: unknown) => [401, 403].includes((error as { response?: { status?: number } })?.response?.status ?? 0);

export default function ManagersPage() {
  const { user } = useAuth();
  return <ManagerDirectory key={`${user?.companyId}:${user?.role}:${user?.id}`} />;
}

function ManagerDirectory() {
  const { t, language } = useLanguage();
  const getManagers = useGetManagers();
  const getLocations = useGetLocations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<Manager | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [success, setSuccess] = useState('');
  const managers: Manager[] = getManagers.data?.data ?? [];
  const locations: LocationWithCounts[] = (getLocations.data?.data ?? []).filter((location: LocationWithCounts) => location.isActive);
  const loading = (getManagers.isPending && !getManagers.data) || (getLocations.isPending && !getLocations.data);
  const unavailable = (getManagers.isError && (!getManagers.data || denied(getManagers.error)))
    || (getLocations.isError && (!getLocations.data || denied(getLocations.error)));
  const error = getManagers.isError ? getManagers.error : getLocations.isError ? getLocations.error : undefined;
  const retry = () => { void getManagers.refetch(); void getLocations.refetch(); };
  const canCreate = !loading && !unavailable && !getLocations.isError && locations.length > 0;
  const number = (value: number) => value.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-PK');
  const active = managers.filter(manager => manager.isActive);
  const covered = new Set(active.flatMap(manager => manager.locations.map(location => location.id)));
  const taken = new Map<number, string>();
  for (const manager of active) {
    if (manager.id === editingManager?.id) continue;
    for (const location of manager.locations) taken.set(location.id, manager.name);
  }
  const add = <button type="button" className="wx-managers-button wx-managers-primary" disabled={!canCreate} onClick={event => {
    event.currentTarget.focus(); setEditingManager(null); setDialogOpen(true);
  }}><Plus size={16} aria-hidden="true" />{t('Add manager')}</button>;
  const filtered = managers.filter(manager => (status === 'all' || manager.isActive === (status === 'active'))
    && `${manager.name} ${manager.email} ${manager.locations.map(location => location.name).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const columns: Column<Manager>[] = [
    { key: 'name', header: 'Manager', sortValue: manager => manager.name, render: manager => <div className="wx-managers-identity">
      <PersonAvatar name={manager.name} /><div><strong><bdi>{manager.name}</bdi></strong><small><bdi dir="ltr">{manager.email}</bdi></small></div>
    </div> },
    { key: 'locations', header: 'Assigned locations', sortValue: manager => manager.locations.length, render: manager => <div className="wx-managers-locations">
      {manager.locations.map(location => <Link key={location.id} className="wx-managers-site" to={`/locations/${location.id}`}><bdi>{location.name}</bdi></Link>)}
      {!manager.locations.length && <span>{t('No locations assigned')}</span>}
    </div> },
    { key: 'status', header: 'Account status', sortValue: manager => manager.isActive ? 1 : 0, render: manager => <StatusPill tone={manager.isActive ? 'ok' : 'neutral'} status={manager.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: 'Actions', className: 'wx-managers-action-cell', render: manager => <div className="wx-managers-actions">
      <button type="button" className="wx-managers-button" disabled={!manager.isActive || getLocations.isError} onClick={event => {
        event.currentTarget.focus(); setEditingManager(manager); setDialogOpen(true);
      }}><Pencil size={14} aria-hidden="true" />{t('Edit')}</button>
      <ManagerAccessActions manager={manager} />
    </div> },
  ];

  return <div className="wx-managers-page">
    <PageHeader title="Managers" subtitle="Review access and the sites assigned to each manager." action={canCreate ? add : undefined} />
    {loading ? <OperationsState loading skeleton="table" /> : unavailable ? <OperationsState error={error} retry={retry} /> : <>
      <OperationsState error={error} retry={retry} />
      {success && <p className="wx-managers-success" role="status">{t(success)}</p>}
      <dl className="wx-managers-summary" aria-label={t('Manager summary')}>
        <div title={t('Company manager accounts')}><dt>{t('Total managers')}</dt><dd>{number(managers.length)}</dd></div>
        <div title={t('Assigned-site access')}><dt>{t('Active managers')}</dt><dd>{number(active.length)}</dd></div>
        <div title={t('One active manager per location')}><dt>{t('Locations covered')}</dt><dd>{number(covered.size)}</dd></div>
      </dl>
      <section className="wx-managers-directory" aria-label={t('Manager assignments')}>
        {managers.length ? <>
          <div className="wx-managers-toolbar">
            <FindField label="Search managers" placeholder="Search by name, email or location" value={search} onChange={setSearch} />
            <SelectMenu label="Account status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All accounts' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          </div>
          <DataTable data={filtered} pageSize={20} rowKey={manager => manager.id} columns={columns} mobileCards emptyIcon={<Users size={28} />} emptyMessage="No managers match these filters." />
          <div className="wx-managers-directory-footer"><span>{t('{shown} of {total} managers', { shown: number(filtered.length), total: number(managers.length) })}</span>
            {(search || status !== 'all') && <button type="button" className="wx-managers-button" onClick={() => { setSearch(''); setStatus('all'); }}>{t('Clear filters')}</button>}
          </div>
        </> : <EmptyState icon={<Users size={28} />} title="No managers yet" message={locations.length
          ? 'Managers see only the locations you assign them. Add one when you have a site to hand over.'
          : 'You need at least one location before you can create a manager.'} action={locations.length ? add
            : <Link className="wx-managers-button wx-managers-primary" to="/locations">{t('Go to locations')}</Link>} />}
      </section>
      <section className="wx-managers-guidance" aria-label={t('Access follows assigned locations')}>
        <ShieldCheck size={22} aria-hidden="true" /><div><h2>{t('Access follows assigned locations')}</h2>
          <p>{t('Give each manager access to the locations they look after.')}</p>
          <p>{t('Managers see their assigned sites. Company owners retain access across the workspace.')}</p>
        </div>
      </section>
      {dialogOpen && <ManagerFormDialog open onOpenChange={setDialogOpen} manager={editingManager}
        locations={locations.map(location => ({ id: location.id, name: location.name }))} takenLocations={taken}
        onSaved={() => setSuccess(editingManager ? 'Manager changes saved.' : 'Manager added.')} />}
    </>}
    <nav className="wx-managers-navigation" aria-label={t('Managers')}>
      <Link className="wx-managers-link" to="/staff"><ArrowLeft size={16} aria-hidden="true" />{t('Back to team')}</Link>
      <Link className="wx-managers-link" to="/locations"><MapPin size={16} aria-hidden="true" />{t('Go to locations')}</Link>
    </nav>
  </div>;
}
