import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/common/DataTable';
import EmptyState from '@/components/common/EmptyState';
import FindField from '@/components/workspace/FindField';
import SelectMenu from '@/components/workspace/SelectMenu';
import StatusPill from '@/components/workspace/StatusPill';
import { nonRetiredFixtureCount } from './types';
import MigrationSetup from './MigrationSetup';
import AreaTemplateForm from './AreaTemplateForm';
import { useSetupFormText } from './areaFormText';
import OperationsState from '../Manager/OperationsState';
import { useAreas } from './queries';
import './area-v6.css';

export default function LocationAreasTab({ locationId }: { locationId: number }) {
  const t = useSetupFormText();
  const query = useAreas(locationId);
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get('area'));
  const creating = params.get('newArea') === '1';
  const editing = Number.isSafeInteger(selectedId) && selectedId > 0;
  const edit = (id?: number) => setParams(old => {
    const next = new URLSearchParams(old); next.set('tab', 'areas');
    next.delete('area'); next.delete('newArea');
    if (id) next.set('area', String(id)); else next.set('newArea', '1');
    return next;
  });
  const close = () => setParams(old => { const next = new URLSearchParams(old); next.delete('area'); next.delete('newArea'); return next; });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('current');
  const httpStatus = (query.error as { response?: { status?: number } } | null)?.response?.status;
  const data = [401, 403, 404, 410].includes(httpStatus ?? 0) ? undefined : query.data;
  const areas = (data ?? []).filter(a =>
    (status === 'all' || (status === 'current' && a.status !== 'ARCHIVED') || a.status === status) &&
    (a.name + ' ' + a.roomType).toLowerCase().includes(search.toLowerCase()),
  );
  return <section className="wx-areas" aria-label={t('Area template')}>
    <div className="wx-areas-heading">
      <div><h2>{t('Area template')}</h2><p>{t('Add an area once, then reuse it in cleaning schedules.')}</p></div>
      <Button className="wx-area-button wx-area-primary" type="button" onClick={() => edit()}><Plus size={16} aria-hidden="true" />{t('Add area template')}</Button>
    </div>
    {(creating || editing) && <AreaTemplateForm key={creating ? 'new' : selectedId} locationId={locationId} areaId={creating ? undefined : selectedId} close={close} created={edit} />}
    <div className="wx-areas-toolbar">
      <FindField label="Search areas" value={search} onChange={setSearch} placeholder={t('Search by area name')} />
      <SelectMenu label="Area status" value={status} onChange={setStatus} options={[
        { value: 'current', label: 'Current areas' }, { value: 'ACTIVE', label: 'Active' },
        { value: 'DRAFT', label: 'Draft' }, { value: 'ARCHIVED', label: 'Archived' }, { value: 'all', label: 'All areas' },
      ]} />
    </div>
    <OperationsState loading={query.isPending} skeleton="table" error={query.error} retry={() => void query.refetch()} />
    {data && (!data.length ? <EmptyState title="Add area template" message="No areas match these filters. Add a room and its fixtures to get started." action={<Button className="wx-area-button wx-area-primary" type="button" onClick={() => edit()}>{t('Add area template')}</Button>} /> : !areas.length ?
      <EmptyState title="No areas match these filters." action={<Button className="wx-area-button" type="button" onClick={() => { setSearch(''); setStatus('current'); }}>{t('Clear filters')}</Button>} /> :
      <DataTable data={areas} pageSize={20} mobileCards rowKey={a => a.id} columns={[
        { key: 'area', header: 'Area', sortValue: a => a.name, render: a => <div className="wx-area-identity"><strong><bdi>{a.name}</bdi></strong><p>{t(a.roomType === 'WASHROOM' ? 'Washroom' : a.roomType === 'GENERAL' ? 'General room' : a.roomType.replaceAll('_', ' ').toLowerCase())}</p><p>{t('{count} required photo views', { count: a.items.filter(item => item.status === 'ACTIVE').reduce((count, item) => count + item.requiredViews.filter(view => view.mandatory !== false).length, 0) })}</p></div> },
        { key: 'fixtures', header: 'Fixtures', sortValue: nonRetiredFixtureCount, render: a => <div className="wx-area-inventory"><span>{t('{count} fixtures selected', { count: nonRetiredFixtureCount(a) })}</span><ul aria-label={t('Fixtures')}>{a.items.filter(item => item.status !== 'RETIRED').map(item => <li key={item.id}><bdi>{item.displayName}</bdi>{item.status === 'MAINTENANCE' && <span> · {t('Maintenance')}</span>}</li>)}</ul></div> },
        { key: 'status', header: 'Status', sortValue: a => a.status, render: a => <StatusPill tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'}>{t(a.status === 'ACTIVE' ? 'Active' : a.status === 'DRAFT' ? 'Draft' : 'Archived')}</StatusPill> },
        { key: 'action', header: 'Action', render: a => <Button className="wx-area-button wx-area-edit" type="button" variant="ghost" onClick={() => edit(a.id)} aria-label={t('Edit {name}', { name: a.name })}><Pencil size={16} aria-hidden="true" /><span>{t('Edit area')}</span></Button> },
      ]} />)}
    <MigrationSetup locationId={locationId} />
  </section>;
}
