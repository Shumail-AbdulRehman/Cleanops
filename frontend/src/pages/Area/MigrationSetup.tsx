import { formatInTimeZone } from 'date-fns-tz';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAreas, useMappingTemplates } from './queries';
import { mapTemplate, apiMessage } from './api';
import { invalidateWorkspace } from '@/lib/invalidateWorkspace';
import InventorySelector from './InventorySelector';
import { inventorySummary, validateInventorySelection, type InventorySelection } from './types';

type Mapping = { areaId: number; mode: 'ALL' | 'SUBSET'; items: InventorySelection[] };
export default function MigrationSetup({ locationId }: { locationId: number }) {
  const templates = useMappingTemplates(locationId), areas = useAreas(locationId), qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, Mapping>>({});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function save(id: number, draft: Mapping) {
    if (busy) return;
    const area = areas.data?.find(a => a.id === draft.areaId && a.status === 'ACTIVE');
    if (!area) return;
    const problem = validateInventorySelection(area, draft.mode, draft.items);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      await mapTemplate(id, { areaId: area.id, inventorySelection: draft.mode, selectedItems: draft.items, expectedInventoryVersion: area.inventoryVersion });
      await invalidateWorkspace(qc);
    } catch (e) {
      setError(apiMessage(e));
      if ((e as { response?: { status?: number } }).response?.status === 409) {
        await areas.refetch();
        setError(`${apiMessage(e)} Inventory refreshed. Review the preview before confirming again. Your selection is preserved.`);
      }
    } finally { setBusy(false); }
  }
  if (templates.isPending || templates.data?.length === 0) return null;
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">Set up existing schedules</h2>
    <p className="text-sm text-muted-foreground">Confirm one room for each schedule. If a schedule covers several rooms, create separate schedules and review staffing conflicts first. Current tasks keep their original requirements.</p>
    <Link to={`/locations/${locationId}?tab=templates`} className="text-sm text-primary underline">Review schedules and create a separate room schedule</Link>
    {error && <p role="alert">{error}</p>}
    {templates.isPending && <p role="status">Loading schedules needing setup…</p>}
    {templates.isError && <div role="alert"><p>Schedules could not be loaded.</p><Button onClick={() => void templates.refetch()}>Retry schedules</Button></div>}
    {areas.isError && <Button onClick={() => void areas.refetch()}>Retry inventory</Button>}
    {templates.data?.length === 0 && <p className="text-sm text-muted-foreground">All active schedules are set up.</p>}
    {templates.data?.filter(t => t.locationId === locationId).map(t => {
      const draft = drafts[t.id] ?? { areaId: t.areaId ?? 0, mode: t.inventorySelection ?? 'ALL', items: t.inventoryItems ?? [] };
      const area = areas.data?.find(a => a.id === draft.areaId && a.status === 'ACTIVE');
      const summary = area && inventorySummary(area, draft.mode, draft.items);
      const problem = area && validateInventorySelection(area, draft.mode, draft.items);
      return <div className="border-b border-border py-4 space-y-3" key={t.id}>
        <p className="font-medium">{t.title}</p>
        <p className="text-sm text-muted-foreground">Existing shift: {t.shiftStart ? formatInTimeZone(t.shiftStart,t.location?.timezone ?? 'UTC','HH:mm') : 'Unset'} to {t.shiftEnd ? formatInTimeZone(t.shiftEnd,t.location?.timezone ?? 'UTC','HH:mm') : 'Unset'} ({t.location?.timezone ?? 'UTC'}) · {t.staff?.name ?? 'Automatic assignment'} · {t._count?.instances ?? 0} pending or in-progress tasks retain the current contract.</p>
        <p className="text-sm text-muted-foreground">Previous photo labels: {t.referenceImages?.map(r => r.name).join(', ') || 'None'}. These labels are suggestions; confirm the actual room.</p>
        <select disabled={busy} aria-label={`Room for ${t.title}`} value={draft.areaId || ''} onChange={e => setDrafts({ ...drafts, [t.id]: { areaId: Number(e.target.value), mode: 'ALL', items: [] } })} className="h-11 w-full rounded-lg border border-border px-3">
          <option value="">Choose one confirmed room</option>
          {areas.data?.filter(a => a.status === 'ACTIVE').map(a => <option value={a.id} key={a.id}>{a.name}</option>)}
        </select>
        {area && <fieldset disabled={busy}><legend className="text-sm font-medium">Future task preview: {area.name}, inventory version {area.inventoryVersion}</legend><InventorySelector id={`mapping-${t.id}`} area={area} mode={draft.mode} selected={draft.items} onChange={(mode, items) => setDrafts({ ...drafts, [t.id]: { ...draft, mode, items } })}/></fieldset>}
        {summary && <p className="text-sm">{summary.mandatory} mandatory fixtures, {summary.optional} optional fixtures, {summary.requiredViews} required photos. Newly active fixtures join future ALL tasks.</p>}
        {problem && <p role="alert" className="text-sm">{problem}</p>}
        <Button disabled={busy || !area || !!problem} onClick={() => void save(t.id, draft)}>Confirm future inventory</Button>
      </div>;
    })}
  </section>;
}
