import { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SidePanel, { SidePanelFooter } from '@/components/workspace/SidePanel';
import StatusPill from '@/components/workspace/StatusPill';
import SegmentedControl from '@/components/workspace/SegmentedControl';
import OperationsState from '../Manager/OperationsState';
import StandardPhotoPreview from './StandardPhotoPreview';
import { setupErrorKey, useSetupFormText } from './areaFormText';
import './area-v6.css';
import { invalidateWorkspace } from '@/lib/invalidateWorkspace';
import { useArea } from './queries';
import { addItems, archiveArea, createArea, editArea, editItem } from './api';
import { fixtureNames, itemEditPayload, previewInventoryCounts, roomPresets, setupFixtureTypes, type AreaItem, type FixtureType, type StandardPhoto } from './types';

function FixtureRow({ item, disabled, save }: { item: AreaItem; disabled: boolean; save: (item: AreaItem) => Promise<boolean> }) {
  const t = useSetupFormText();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.displayName);
  const [status, setStatus] = useState(item.status);
  return <li className="wx-area-fixture">
    {editing ? <form className="wx-area-fixture-edit" onSubmit={event => {
      event.preventDefault();
      if (!disabled && name.trim()) void save({ ...item, displayName: name, status }).then(ok => { if (ok) setEditing(false); });
    }}>
      <label>{t('Fixture name')}<Input required value={name} disabled={disabled} onChange={event => setName(event.target.value)} maxLength={100} /></label>
      <label>{t('Status')}<select value={status} disabled={disabled} onChange={event => setStatus(event.target.value as AreaItem['status'])}>
        <option value="ACTIVE">{t('Active')}</option><option value="MAINTENANCE">{t('Maintenance')}</option><option value="RETIRED">{t('Remove from template')}</option>
      </select></label>
      <div className="wx-area-actions"><Button className="wx-area-button wx-area-primary" disabled={disabled || !name.trim()} type="submit">{t('Save fixture')}</Button><Button className="wx-area-button" variant="ghost" disabled={disabled} type="button" onClick={() => setEditing(false)}>{t('Cancel')}</Button></div>
    </form> : <>
      <div className="wx-area-fixture-name"><strong><bdi>{item.displayName}</bdi></strong><p>{item.requiredViews.map(view => t(view.instructions ?? view.key.replaceAll('_', ' '))).join(' ')}</p></div>
      <label className="wx-area-fixture-status"><span className="sr-only">{t('Status')}: <bdi>{item.displayName}</bdi></span><select value={item.status} disabled={disabled} onChange={event => void save({ ...item, status: event.target.value as AreaItem['status'] })}><option value="ACTIVE">{t('Active')}</option><option value="MAINTENANCE">{t('Maintenance')}</option></select></label>
      <Button className="wx-area-button wx-area-edit" type="button" variant="ghost" disabled={disabled} onClick={() => { setName(item.displayName); setStatus(item.status); setEditing(true); }} aria-label={t('Edit {name}', { name: item.displayName })}><Pencil size={15} aria-hidden="true" /><span className="sr-only">{t('Edit')}</span></Button>
      <Button className="wx-area-button wx-area-remove" type="button" variant="ghost" disabled={disabled} aria-label={`${t('Remove from template')}: ${item.displayName}`} onClick={() => void save({ ...item, status: 'RETIRED' })}><X size={16} aria-hidden="true" /></Button>
    </>}
  </li>;
}

export default function AreaTemplateForm({ locationId, areaId, close, created }: {
  locationId: number; areaId?: number; close: () => void; created: (id: number) => void;
}) {
  const t = useSetupFormText(), qc = useQueryClient(), formId = useId();
  const query = useArea(areaId ?? 0);
  const httpStatus = (query.error as { response?: { status?: number } } | null)?.response?.status;
  const area = [401, 403, 404, 410].includes(httpStatus ?? 0) ? undefined : query.data;
  const [name, setName] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [roomType, setRoomType] = useState<keyof typeof roomPresets>('WASHROOM');
  const [counts, setCounts] = useState<Record<FixtureType, number>>({ ...roomPresets.WASHROOM.defaults });
  const [addType, setAddType] = useState<FixtureType>('INDIAN_TOILET'), [addCount, setAddCount] = useState(1);
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [archive, setArchive] = useState(false);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const items = (area?.items ?? []).filter(item => item.status !== 'RETIRED').sort((a, b) => a.sequence - b.sequence);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const unavailable = !!areaId && (!area || area.locationId !== locationId);
  const disabled = busy || uncertain || area?.status === 'ARCHIVED' || (!!areaId && (query.isError || unavailable));
  const validAdd = Number.isSafeInteger(addCount) && addCount >= 1 && items.length + addCount <= 200;
  const preview = validAdd ? previewInventoryCounts([{ fixtureType: addType, count: addCount }], area?.items) : [];
  const dismiss = () => { if (!inFlight.current) close(); };
  async function mutate(work: () => Promise<unknown>, message: string) {
    if (inFlight.current || disabled) return false;
    inFlight.current = true; setBusy(true); setError(''); setSuccess('');
    try { await work(); setSuccess(message); await invalidateWorkspace(qc).catch(() => undefined); return true; }
    catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (!areaId && (!status || status >= 500)) {
        setUncertain(true); setError('Area creation could not be confirmed. Close and check the area list before trying again.');
      } else setError(setupErrorKey(err, 'Could not save the area template. Check the fields and try again.'));
      if (status === 409) {
        const refreshed = await query.refetch();
        setError(refreshed.isError ? 'The template could not refresh. Your edits are preserved. Retry loading it.' : 'The template was refreshed. Your edits are preserved; review them and save again.');
      }
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function save() {
    const value = (name ?? area?.name ?? '').trim();
    if (!value || disabled || (area && area.locationId !== locationId)) return;
    if (areaId && area) {
      await mutate(() => editArea(area.id, { name: value, layoutInstructions: instructions ?? area.layoutInstructions ?? '', expectedInventoryVersion: area.inventoryVersion }), 'Area template saved.');
    } else if (total > 0 && total <= 200) {
      let id: number | undefined;
      const ok = await mutate(async () => { const result = await createArea(locationId, { name: value, roomType, layoutInstructions: instructions ?? '', counts: roomPresets[roomType].fixtureTypes.map(fixtureType => ({ fixtureType, count: counts[fixtureType] })).filter(row => row.count > 0) }); id = result.id; }, 'Area template created.');
      if (ok && id) created(id);
    }
  }
  return <SidePanel open wide title={t(areaId ? 'Edit area template' : 'Prepare area template')} description={t(areaId ? 'Template changes apply to future tasks. Existing tasks keep their required photos.' : 'Name the area and choose what staff need to clean.')} onOpenChange={open => { if (!open) dismiss(); }} footer={
    <SidePanelFooter className="wx-area-footer">
      <Button className="wx-area-button" type="button" variant="outline" disabled={busy} onClick={dismiss}>{t('Cancel')}</Button>
      <Button className="wx-area-button wx-area-primary" type="submit" form={formId} aria-busy={busy} disabled={disabled || !(name ?? area?.name ?? '').trim() || (!areaId && (total < 1 || total > 200))}>{t(busy ? 'Saving…' : areaId ? 'Save changes' : 'Create area template')}</Button>
    </SidePanelFooter>
  }>
    <div className="wx-area-editor" aria-busy={busy}>
      {areaId && query.isPending ? <OperationsState loading skeleton="panel" /> : unavailable ? <div role="alert"><p>{t('Area template could not be loaded.')}</p><p>{t('Your saved records have not changed.')}</p><Button className="wx-area-button" type="button" variant="outline" onClick={() => void query.refetch()}>{t('Retry')}</Button></div> : <>
        {areaId && query.isError && <OperationsState error={query.error} retry={() => void query.refetch()} />}
        {error && <p id={`${formId}-error`} role="alert" className="wx-area-error">{t(error)}</p>}
        {uncertain && <Button className="wx-area-button" type="button" variant="outline" onClick={dismiss}>{t('Close and check areas')}</Button>}
        {success && <p role="status" className="wx-area-success">{t(success)}</p>}
        {area && <div className="wx-area-summary"><StatusPill tone={area.status === 'ACTIVE' ? 'ok' : 'neutral'}>{t(area.status === 'ACTIVE' ? 'Active' : area.status === 'DRAFT' ? 'Draft' : 'Archived')}</StatusPill></div>}
        <form id={formId} className="wx-area-fields" aria-describedby={error ? `${formId}-error` : undefined} onSubmit={event => { event.preventDefault(); void save(); }}>
          <label>{t('Area name')}<Input required aria-label={t('Area name')} aria-describedby={error ? `${formId}-error` : undefined} value={name ?? area?.name ?? ''} disabled={disabled} maxLength={100} placeholder={t('East washroom')} onChange={event => setName(event.target.value)} /></label>
          {!areaId && <div className="wx-area-type"><span>{t('Area type')}</span><SegmentedControl label={t('Area type')} disabled={disabled} value={roomType} options={[{ value: 'WASHROOM', label: t('Washroom') }, { value: 'GENERAL', label: t('General room') }]} onChange={value => { const preset = value as keyof typeof roomPresets; setRoomType(preset); setCounts({ ...roomPresets[preset].defaults }); }} /></div>}
          <label>{t('Cleaning instructions (optional)')}<Textarea disabled={disabled} value={instructions ?? area?.layoutInstructions ?? ''} onChange={event => setInstructions(event.target.value)} /></label>
          {!areaId && <fieldset disabled={disabled} aria-describedby={`${formId}-counts`}><legend>{t('Fixtures')}</legend><div className="wx-area-counts">{roomPresets[roomType].fixtureTypes.map(type => <label key={type}>{t(fixtureNames[type])}<Input aria-label={t(fixtureNames[type])} type="number" min={0} max={200} value={counts[type]} onChange={event => setCounts({ ...counts, [type]: Math.max(0, Math.min(200, Math.floor(Number(event.target.value) || 0))) })} /></label>)}</div><p id={`${formId}-counts`}>{t('{count} fixtures selected', { count: total })}</p><p className={total > 200 ? 'wx-area-error' : undefined} role={total > 200 ? 'alert' : undefined}>{t('Choose at most 200 fixtures.')}</p></fieldset>}
        </form>
        {area && <>
          <div className="wx-area-fixtures-heading"><h3>{t('Fixtures')}</h3><Button className="wx-area-button" type="button" variant="outline" disabled={disabled || items.length >= 200} aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus size={15} aria-hidden="true" />{t('Add fixtures')}</Button></div>
          {adding && <form className="wx-area-add wx-area-fields" onSubmit={event => { event.preventDefault(); if (disabled || !validAdd) return; void mutate(() => addItems(area.id, [{ fixtureType: addType, count: addCount }], area.inventoryVersion), 'Fixtures added.').then(ok => { if (ok) setAdding(false); }); }}>
            <div className="wx-area-add-fields"><label>{t('Fixture type')}<select value={addType} disabled={disabled} onChange={event => setAddType(event.target.value as FixtureType)}>{setupFixtureTypes.map(type => <option value={type} key={type}>{t(fixtureNames[type])}</option>)}</select></label>
            <label>{t('Count')}<Input type="number" min={1} max={200 - items.length} value={addCount} disabled={disabled} onChange={event => setAddCount(Number(event.target.value))} /></label></div>
            <div className="wx-area-name-preview"><strong>{t('Fixture name')}</strong><output>{preview.slice(0, 3).map(row => row.displayName).join(', ')}{preview.length > 3 ? '…' : ''}</output><p>{t('Names are assigned automatically. Edit a fixture after adding it.')}</p></div>
            {!validAdd && <p role="alert" className="wx-area-error">{t('Choose at most 200 fixtures.')}</p>}
            <div className="wx-area-actions"><Button className="wx-area-button wx-area-primary" type="submit" disabled={disabled || !validAdd}>{t('Add fixtures')}</Button><Button className="wx-area-button" type="button" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>{t('Cancel')}</Button></div>
          </form>}
          {!items.length && <p>{t('Choose at least one fixture.')}</p>}
          <ul className="wx-area-fixtures">{items.map(item => <FixtureRow key={item.id} item={item} disabled={disabled} save={item => mutate(() => editItem(area.id, item.id, itemEditPayload(item, area.inventoryVersion)), 'Fixture saved.')} />)}</ul>
          {area.status === 'DRAFT' && <Button className="wx-area-button" type="button" variant="outline" disabled={disabled || !items.length} onClick={() => void mutate(() => editArea(area.id, { status: 'ACTIVE', expectedInventoryVersion: area.inventoryVersion }), 'Area template activated.')}>{t('Activate area')}</Button>}
          {!!(area as typeof area & { standards?: StandardPhoto[] }).standards?.length && <StandardPhotos areaId={area.id} standards={(area as typeof area & { standards: StandardPhoto[] }).standards} />}
          {area.status !== 'ARCHIVED' && <div className="wx-area-archive">{archive ? <div><p>{t('Archive this template? It will no longer be available for new schedules. Existing tasks and evidence stay saved.')}</p><div className="wx-area-actions"><Button className="wx-area-button wx-area-danger" type="button" disabled={disabled} onClick={() => void mutate(() => archiveArea(area.id, area.inventoryVersion), 'Area template archived.').then(ok => { if (ok) setArchive(false); })}>{t('Confirm archive')}</Button><Button className="wx-area-button" type="button" variant="ghost" disabled={busy} onClick={() => setArchive(false)}>{t('Cancel')}</Button></div></div> : <Button className="wx-area-button wx-area-danger" type="button" variant="ghost" disabled={disabled} onClick={() => setArchive(true)}>{t('Archive template')}</Button>}</div>}
        </>}
      </>}
    </div>
  </SidePanel>;
}

/** The disclosure mounts protected viewers only while it is open. */
function StandardPhotos({ areaId, standards }: { areaId: number; standards: StandardPhoto[] }) {
  const t = useSetupFormText();
  const [open, setOpen] = useState(false);
  return <details className="wx-area-standards" onToggle={event => setOpen(event.currentTarget.open)}><summary>{t('Standard photos')}</summary>{open && standards.map(standard => <StandardPhotoPreview key={standard.id} areaId={areaId} standard={standard} />)}</details>;
}
