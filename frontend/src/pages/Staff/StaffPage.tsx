import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { ArrowRight, MapPin, MoreHorizontal, Plus, Users } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/i18n/context';
import { formatDays, isEveryDay } from '@/lib/workDays';
import useAuth from '@/hooks/useAuth';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import DataTable, { type Column } from '@/components/common/DataTable';
import PersonAvatar from '@/components/workspace/PersonAvatar';
import SiteAvatar from '@/components/workspace/SiteAvatar';
import StatusPill from '@/components/workspace/StatusPill';
import FindField from '@/components/workspace/FindField';
import SelectMenu from '@/components/workspace/SelectMenu';
import OperationsState from '../Manager/OperationsState';
import { useGetLocations } from '../Location/queries';
import { useGetStaff, getStaffDetailsQueryOptions } from './queries';
import WorkforceActions from './WorkforceActions';
import StaffCreateDialog from './StaffCreateDialog';
import StaffEditDialog, { type EditableStaff } from './StaffEditDialog';
import './team-v6.css';

interface StaffMember extends EditableStaff { locationId: number | null }
interface LocationOption { id: number; name: string; timezone: string; isActive?: boolean }
const shiftTime = (date: string | null, timezone: string) => date ? formatInTimeZone(new Date(date), timezone, 'HH:mm') : '—';
const denied = (error: unknown) => [401, 403].includes((error as { response?: { status?: number } })?.response?.status ?? 0);

function RowMenu({ person, canAccess, onEdit, onAccess }: { person: StaffMember; canAccess: boolean; onEdit(): void; onAccess(): void }) {
  const { t, language } = useLanguage();
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingPanel = useRef<(() => void) | null>(null);
  const launch = (action: () => void) => { pendingPanel.current = action; };
  return <DropdownMenu.Root dir={language === 'ur' ? 'rtl' : 'ltr'} onOpenChange={open => { if (open) pendingPanel.current = null; }}>
    <DropdownMenu.Trigger asChild><button ref={trigger} type="button" className="wx-team-button wx-team-menu-trigger" aria-label={`${t('Actions')}: ${person.name}`}><MoreHorizontal size={18} aria-hidden="true" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><div className="workspace wx-team-portal" dir={language === 'ur' ? 'rtl' : 'ltr'} lang={language === 'ur' ? 'ur-PK' : 'en-PK'}>
      <DropdownMenu.Content className="wx-team-menu" align="end" sideOffset={6} collisionPadding={12} loop aria-label={`${t('Actions')}: ${person.name}`}
        onCloseAutoFocus={event => {
          if (!pendingPanel.current) return;
          event.preventDefault();
          const action = pendingPanel.current;
          pendingPanel.current = null;
          // Let Radix release the menu's focus scope before opening the dialog.
          queueMicrotask(() => { trigger.current?.focus(); action(); });
        }}>
        <DropdownMenu.Item asChild><Link className="wx-team-menu-item" to={`/staff/${person.id}`}>{t('View details')}</Link></DropdownMenu.Item>
        <DropdownMenu.Item className="wx-team-menu-item" disabled={!person.isActive} onSelect={() => launch(onEdit)}>{t('Edit')}</DropdownMenu.Item>
        <DropdownMenu.Item className="wx-team-menu-item" disabled={!person.isActive || !canAccess} onSelect={() => launch(onAccess)}>{t('Staff access')}</DropdownMenu.Item>
      </DropdownMenu.Content>
    </div></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export default function StaffPage() {
  const { user } = useAuth();
  return <TeamDirectory key={`${user?.companyId}:${user?.role}:${user?.id}`} />;
}

function TeamDirectory() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const staffQuery = useGetStaff();
  const locationsQuery = useGetLocations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [accessStaff, setAccessStaff] = useState<StaffMember | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const locationFilter = params.get('locationId') ?? 'all';
  const dialogOpen = params.get('create') === '1';
  const setLocationFilter = (value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value === 'all') next.delete('locationId'); else next.set('locationId', value); return next; }, { replace: true });
  const setDialogOpen = (open: boolean) => setParams(previous => { const next = new URLSearchParams(previous); if (open) next.set('create', '1'); else next.delete('create'); return next; }, { replace: true });
  const staff = (staffQuery.data?.data ?? []) as StaffMember[];
  const locations = (locationsQuery.data?.data ?? []) as LocationOption[];
  const locMap = new Map(locations.map(location => [location.id, location]));
  const filtered = staff.filter(person => `${person.name} ${person.email ?? ''} ${person.phone ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && (locationFilter === 'all' || (locationFilter === 'unassigned' ? person.locationId == null : person.locationId === Number(locationFilter)))
    && (accountFilter === 'all' || person.isActive === (accountFilter === 'active')));
  const timezone = (person: StaffMember) => locMap.get(person.locationId ?? -1)?.timezone ?? 'UTC';
  const canAccess = (person: StaffMember) => user?.role === 'ADMIN' || (user?.role === 'MANAGER' && person.locationId != null && locMap.has(person.locationId));
  const number = (value: number) => value.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-PK');
  const unassigned = staff.filter(person => person.locationId == null).length;
  const retry = () => { void staffQuery.refetch(); void locationsQuery.refetch(); };
  const error = staffQuery.isError ? staffQuery.error : locationsQuery.isError ? locationsQuery.error : undefined;
  const loading = (staffQuery.isLoading && !staffQuery.data) || (locationsQuery.isPending && !locationsQuery.data);
  const unavailable = (staffQuery.isError && (!staffQuery.data || denied(staffQuery.error))) || (locationsQuery.isError && (!locationsQuery.data || denied(locationsQuery.error)));
  const canCreate = !loading && !unavailable && !locationsQuery.isError;
  const add = <button type="button" className="wx-team-button wx-team-primary" onClick={() => setDialogOpen(true)} disabled={!canCreate}><Plus size={16} aria-hidden="true" />{t('Add team member')}</button>;
  const columns: Column<StaffMember>[] = [
    { key: 'name', header: 'Team member', sortValue: person => person.name, render: person => <div className="wx-team-identity"><PersonAvatar name={person.name} /><Link to={`/staff/${person.id}`}><bdi>{person.name}</bdi></Link></div> },
    { key: 'contact', header: 'Contact', render: person => <div className="wx-team-contact"><bdi dir="ltr">{person.phone || '—'}</bdi><small>{person.email ? <bdi dir="ltr">{person.email}</bdi> : t('No email')}</small></div> },
    { key: 'location', header: 'Location & shift', sortValue: person => locMap.get(person.locationId ?? -1)?.name ?? '', render: person => {
      const site = locMap.get(person.locationId ?? -1);
      const name = person.locationId == null ? t('Unassigned') : site?.name ?? `#${person.locationId}`;
      const days = person.workDays;
      return <div className="wx-team-identity"><SiteAvatar name={person.locationId == null ? null : name} /><div><strong><bdi>{name}</bdi></strong><small>
        <bdi dir="ltr">{shiftTime(person.shiftStart, timezone(person))}–{shiftTime(person.shiftEnd, timezone(person))}</bdi>
        {days?.length && !isEveryDay(days) ? <> · <bdi>{formatDays(days, t, language)}</bdi></> : null}
        {' · '}<bdi>{timezone(person)}</bdi>
      </small></div></div>;
    } },
    { key: 'status', header: 'Account status', render: person => <StatusPill tone={person.isActive ? 'ok' : 'neutral'} status={person.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: 'Actions', className: 'wx-team-action-cell', render: person => <RowMenu person={person} canAccess={canAccess(person)} onEdit={() => setEditingStaff({ ...person, location: locMap.get(person.locationId ?? -1) ?? person.location })} onAccess={() => { setAccessStaff(person); setAccessOpen(true); }} /> },
  ];
  return <div className="wx-team-page">
    <PageHeader title="Your people, at a glance" subtitle="Current assignments and account access. Open a person for attendance and task history." action={add} />
    {loading ? <OperationsState loading skeleton="table" /> : unavailable ? <OperationsState error={error} retry={retry} /> : <>
      <OperationsState error={error} retry={retry} />
      {success && <p role="status" className="wx-team-success">{t(success)}</p>}
      <dl className="wx-team-summary" aria-label={t('Team summary')}>
        <div title={t('Current active accounts')}><dt>{t('Active staff')}</dt><dd>{number(staff.filter(person => person.isActive).length)}</dd></div>
        <div title={t('Staff with a current location')}><dt>{t('Assigned staff')}</dt><dd>{number(staff.filter(person => person.locationId != null).length)}</dd></div>
        <div className={unassigned > 0 ? 'wx-team-needs-site' : undefined} title={t('Assign a site before starting work')}><dt>{t('Unassigned hires')}</dt><dd>{number(unassigned)}</dd></div>
      </dl>
      <section className="wx-team-directory" aria-label={t('Your team')}>
        <div className="wx-team-toolbar">
          <FindField label="Search team" placeholder="Search by name, email or phone" value={search} onChange={setSearch} />
          <SelectMenu label="Filter by location" icon={<MapPin size={16} />} value={locationFilter} onChange={setLocationFilter} options={[
            { value: 'all', label: 'All locations' }, ...(user?.role === 'ADMIN' ? [{ value: 'unassigned', label: 'Unassigned' }] : []),
            ...locations.map(location => ({ value: String(location.id), label: location.name, translateLabel: false })),
          ]} />
          <SelectMenu label="Account status" value={accountFilter} onChange={setAccountFilter} options={[{ value: 'all', label: 'All accounts' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          {user?.role === 'ADMIN' && <Link className="wx-team-link wx-team-managers" to="/managers">{t('Manage managers')}<ArrowRight size={16} aria-hidden="true" /></Link>}
        </div>
        {staff.length === 0 ? <EmptyState icon={<Users size={28} />} title="Add your first team member" message="No team members yet. Add your first team member to get started." action={add} /> : <DataTable pageSize={20} mobileCards columns={columns} data={filtered} rowKey={person => person.id}
          emptyIcon={<Users size={28} />} emptyMessage="No team members match these filters."
          onRowHover={person => { void queryClient.prefetchQuery(getStaffDetailsQueryOptions(person.id)); }} onRowClick={person => navigate(`/staff/${person.id}`)} />}
        <div className="wx-team-directory-footer"><span>{t('{shown} of {total} team members', { shown: number(filtered.length), total: number(staff.length) })}</span>
          {search || locationFilter !== 'all' || accountFilter !== 'all' ? <button type="button" className="wx-team-button" onClick={() => { setSearch(''); setLocationFilter('all'); setAccountFilter('all'); }}>{t('Clear filters')}</button> : null}
          <Link className="wx-team-link" to="/attendance">{t('Open attendance')}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>
      <div className="wx-team-guidance"><section><h2>{t(user?.role === 'ADMIN' ? 'Manager assignments' : 'Assigned-site access')}</h2>
        <p>{t(user?.role === 'ADMIN' ? 'Review each manager’s assigned sites. Release the previous manager’s access before assigning a replacement.' : 'You can manage staff only at your assigned sites. Contact the company owner for manager access changes.')}</p>
        <p>{t(user?.role === 'ADMIN' ? 'Company-wide scope' : 'Assigned-site scope')} · {t('Locations')}: {number(locations.length)} · {t('Locations available to your account')}</p>
        <p>{t(user?.role === 'ADMIN' ? 'Owners can stage new hires' : 'Managers must choose an assigned site')} · {t('Assign a site before starting work')}</p>
      </section><section><h2>{t('Safe offboarding')}</h2><p>{t('Keep retained evidence and history. Use Staff access to record a reason, end access or transfer a person safely.')}</p></section></div>
      {dialogOpen && <StaffCreateDialog open onOpenChange={setDialogOpen} locations={locations} location={locations.find(location => String(location.id) === locationFilter)} onSaved={() => setSuccess('Team member added.')} />}
      {editingStaff && <StaffEditDialog person={editingStaff} timezone={timezone(editingStaff)} onClose={() => setEditingStaff(null)} onSaved={() => setSuccess('Team member changes saved.')} />}
      {accessStaff && <WorkforceActions person={staff.find(person => person.id === accessStaff.id) ?? accessStaff} locations={locations} open={accessOpen} onOpenChange={setAccessOpen} />}
    </>}
  </div>;
}
