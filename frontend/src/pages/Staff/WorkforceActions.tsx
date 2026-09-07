import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { invalidateWorkspace } from '@/lib/invalidateWorkspace';
import { Textarea } from '@/components/ui/textarea';
import SelectMenu from '@/components/workspace/SelectMenu';
import SidePanel, { SidePanelFieldError, SidePanelFooter } from '@/components/workspace/SidePanel';
import { checkStaffReason } from './staffFieldRules';
import './staff-access-v6.css';

type Action = 'deactivate' | 'archive' | 'transfer' | 'signOut';
export interface WorkforceRecord { id: number; name: string; isActive: boolean; locationId?: number | null; role?: string }
export interface WorkforceSite { id: number; name: string; isActive?: boolean }
type PersonProps = { person: WorkforceRecord; locations?: WorkforceSite[]; entity?: 'staff' | 'manager' };
export type WorkforceActionsProps = PersonProps & (
  | { open: boolean; onOpenChange: (open: boolean) => void }
  | { open?: undefined; onOpenChange?: undefined }
);

export default function WorkforceActions(props: WorkforceActionsProps) {
  const { user } = useAuth();
  const identity = `${user?.companyId}:${user?.role}:${user?.id}:${props.person.id}:${props.entity ?? 'staff'}`;
  return <DraftWorkforceActions key={identity} {...props} />;
}

function DraftWorkforceActions(props: WorkforceActionsProps) {
  const [selfOpen, setSelfOpen] = useState(false);
  const [action, setAction] = useState<Action>('deactivate');
  const [reason, setReason] = useState('');
  const [destination, setDestination] = useState('');
  const open = props.open ?? selfOpen;
  const setOpen = props.onOpenChange ?? setSelfOpen;
  // Draft survives a scope refresh while pending feedback belongs to the old scope.
  const scope = `${props.person.locationId}:${props.person.isActive}:${props.locations?.map(site => `${site.id}:${site.isActive}`).join(',')}`;
  return <ScopedWorkforceActions key={scope} {...props} controlled={props.open !== undefined} open={open} setOpen={setOpen}
    action={action} setAction={setAction} reason={reason} setReason={setReason} destination={destination} setDestination={setDestination} />;
}

type DraftProps = PersonProps & {
  open: boolean; controlled: boolean; setOpen: (value: boolean) => void;
  action: Action; setAction: (value: Action) => void;
  reason: string; setReason: (value: string) => void;
  destination: string; setDestination: (value: string) => void;
};
function ScopedWorkforceActions({ person, locations = [], entity = 'staff', controlled, open, setOpen, action, setAction, reason, setReason, destination, setDestination }: DraftProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const lifetime = useRef(0);
  const formId = useId();
  const id = (field: string) => `${formId}-${field}`;
  const [reasonTouched, setReasonTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Action | null>(null);
  const [previousOpen, setPreviousOpen] = useState(open);
  // A parent can close the panel directly. Keep SidePanel mounted to return focus.
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setReasonTouched(false);
    setError('');
    setBusy(false);
    setRefreshing(false);
    if (open) setSaved(null);
  }
  useEffect(() => {
    inFlight.current = false;
    // Invalidate pending feedback on close, scope/principal change or unmount.
    return () => { lifetime.current += 1; };
  }, [open]);

  const permitted = user?.role === 'ADMIN' || (user?.role === 'MANAGER' && entity === 'staff' && person.locationId != null && locations.some(site => site.id === person.locationId));
  if (!permitted || person.role === 'ADMIN') return null;
  const sites = locations.filter(site => site.isActive !== false && site.id !== person.locationId);
  const pending = busy || refreshing;
  const trimmedReason = reason.trim();
  const reasonCheck = checkStaffReason(trimmedReason);
  const reasonError = reasonCheck !== true && (reasonTouched || trimmedReason !== '') ? reasonCheck : null;
  const destinationValid = action !== 'transfer' || sites.some(site => String(site.id) === destination);
  const close = () => {
    if (inFlight.current || pending) return;
    setReason('');
    setError('');
    setDestination('');
    setAction('deactivate');
    setOpen(false);
  };
  const refresh = async () => {
    if (!open || inFlight.current || pending) return;
    const requestLifetime = lifetime.current;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await Promise.all([
        qc.refetchQueries({ queryKey: ['staff'], type: 'active' }, { throwOnError: true }),
        qc.refetchQueries({ queryKey: ['getLocations'], type: 'active' }, { throwOnError: true }),
        qc.refetchQueries({ queryKey: ['getManagers'], type: 'active' }, { throwOnError: true }),
      ]);
      if (lifetime.current === requestLifetime) setError('Access context refreshed. Review the selected action and your draft before confirming.');
    } catch {
      if (lifetime.current === requestLifetime) setError('The record could not be refreshed. Your draft is kept. Try again when connected.');
    } finally {
      if (lifetime.current === requestLifetime) { inFlight.current = false; setRefreshing(false); }
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!open || inFlight.current || pending || !person.isActive) return;
    setReasonTouched(true);
    if (reasonCheck !== true || !destinationValid) return;
    const payload = { reason: trimmedReason };
    const requestLifetime = lifetime.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'signOut') {
        await client.post(`/common/security/staff/${person.id}/sign-out-everywhere`, payload);
      } else if (action === 'transfer') {
        await client.post(`/workforce/staff/${person.id}/transfer/${destination}`, { ...payload, expectedLocationId: person.locationId ?? null });
      } else if (action === 'archive') {
        await client.post(`/${entity}/${person.id}/archive`, payload);
      } else await client.post(`/workforce/${entity}/${person.id}/deactivate`, payload);
      if (lifetime.current !== requestLifetime) return;
      setSaved(action);
      if (action !== 'signOut') {
        qc.removeQueries({ queryKey: ['staff', 'details', person.id] });
        qc.removeQueries({ queryKey: ['attendance'] });
        void invalidateWorkspace(qc);
      }
      setOpen(false);
      setReason('');
      setDestination('');
    } catch (cause) {
      if (lifetime.current !== requestLifetime) return;
      const status = (cause as { response?: { status?: number } })?.response?.status;
      setError(status === 404 || status === 409 ? 'The record changed or a shift is open. Finish checkout, refresh the record, then try again. Your draft is kept.'
        : status === 403 ? 'You do not have access to this action. Refresh your assigned sites.'
          : 'The action could not be confirmed. Refresh the record before retrying. Your draft is kept.');
    } finally {
      if (lifetime.current === requestLifetime) { inFlight.current = false; setBusy(false); }
    }
  };
  const actions = <SidePanelFooter className="wx-access-actions">
    <button type="button" className="wx-access-button" disabled={pending} onClick={close}>{t('Cancel')}</button>
    <button type="submit" form={formId} className="wx-access-button wx-access-primary" aria-busy={busy}
      disabled={pending || !person.isActive || reasonCheck !== true || !destinationValid}>
      {t(busy ? 'Saving…' : 'Confirm access change')}
    </button>
  </SidePanelFooter>;
  return <span onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} className="wx-access-launcher">
    {!person.isActive ? <span>{t('Archived / inactive')}</span> : !controlled && <button type="button" className="wx-access-button" onClick={() => { setSaved(null); setOpen(true); }}>{t(entity === 'manager' ? 'Manage access' : 'Staff access')}</button>}
    {saved && !open && <span className="wx-access-success" role="status">{t(saved === 'signOut' ? 'Signed out of all devices.' : 'Access change saved. History preserved.')}</span>}
    <SidePanel open={open && person.isActive} onOpenChange={value => { if (!value) close(); }} title={entity === 'manager' ? 'Manager access' : 'Staff access'}
      description="Attendance, tasks and evidence are preserved. Access changes revoke existing sessions. No general restore is available." footer={actions}>
      <div className="wx-access-content">
        <p className="wx-access-person"><bdi>{person.name}</bdi></p>
        <form id={formId} onSubmit={event => void save(event)} className="wx-access-form" aria-busy={pending} noValidate>
          <fieldset className="wx-access-fields" disabled={pending}>
            <div className="wx-access-field">
              <label htmlFor={id('action')}>{t('Action')}</label>
              <select id={id('action')} value={action} onChange={event => { setAction(event.target.value as Action); setError(''); }}>
                <option value="deactivate">{t(entity === 'manager' ? 'Deactivate and release sites' : 'Deactivate access')}</option>
                <option value="archive">{t('Archive and preserve history')}</option>
                {entity === 'staff' && <><option value="transfer" disabled={!sites.length}>{t('Transfer site')}</option><option value="signOut">{t('Sign out of all devices')}</option></>}
              </select>
            </div>
            {entity === 'manager' && <p className="wx-access-help">{t('For a handover, deactivate this manager first. After the sites are released, edit the active replacement manager and assign those sites. The previous manager loses access immediately.')}</p>}
            {action === 'signOut' && <p className="wx-access-help">{t('This signs the staff member out on every phone. They sign in again with their phone number and a new code.')}</p>}
            {action === 'transfer' && <div className="wx-access-field" role="group" aria-labelledby={id('destination-label')} aria-describedby={id('transfer-hint')}>
              <span id={id('destination-label')} className="wx-access-label">{t('Destination site')}</span>
              <SelectMenu label="Destination site" value={destination} disabled={pending} onChange={setDestination}
                options={[{ value: '', label: 'Select assigned site' }, ...sites.map(site => ({ value: String(site.id), label: site.name, translateLabel: false }))]} />
              <p id={id('transfer-hint')} className="wx-access-help">{t('An open shift must be checked out first. Recorded attendance stays at its original site; incomplete assignments are released.')}</p>
            </div>}
            <div className="wx-access-field">
              <label htmlFor={id('reason')}>{t('Reason')}</label>
              <Textarea id={id('reason')} rows={3} required value={reason}
                aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? id('reason-error') : undefined}
                onBlur={() => setReasonTouched(true)} onChange={event => setReason(event.target.value)} />
              <SidePanelFieldError id={id('reason-error')}>{reasonError}</SidePanelFieldError>
            </div>
          </fieldset>
          {error && <div className="wx-access-error">
            <p role="alert">{t(error)}</p>
            <button type="button" className="wx-access-button" disabled={pending} aria-busy={refreshing} onClick={() => void refresh()}>{t(refreshing ? 'Refreshing…' : 'Refresh access context')}</button>
          </div>}
        </form>
      </div>
    </SidePanel>
  </span>;
}
