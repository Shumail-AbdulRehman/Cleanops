export type FixtureType = 'TOILET' | 'INDIAN_TOILET' | 'WESTERN_TOILET' | 'SINK' | 'MIRROR' | 'BIN' | 'FLOOR' | 'CUSTOM';
export type AreaItem = {
  id: number; areaId: number; stableCode: string; displayName: string; fixtureType: FixtureType;
  positionHint: string | null; sequence: number; identificationMode: 'PRINTED_LABEL' | 'EXISTING_NUMBER' | 'ORDERED_CONTEXT';
  existingNumber: string | null; status: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
  rubricKey: string; requiredViews: Array<{ key: string; instructions?: string; mandatory?: boolean }>;
};
export type Area = {
  id: number; locationId: number; name: string; roomType: string; status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  inventoryVersion: number; qrVersion: number; layoutInstructions: string | null; items: AreaItem[];
  templates?: Array<{ id: number; title: string; setupStatus: string; isActive: boolean; inventorySelection?: 'ALL' | 'SUBSET'; inventoryItems?: InventorySelection[] }>;
  _count?: { items?: number; instances?: number; exceptions?: number };
  activeScheduleCount?: number; exceptionCount?: number;
};
export type InventoryCount = { fixtureType: FixtureType; count: number };
export type InventorySelection = { areaItemId: number; mandatory: boolean };
export type StandardPhoto = { privacyState?: string; id: number; mediaAssetId: string; caption: string | null; areaItemId: number | null };
export const fixtureNames: Record<FixtureType, string> = { TOILET: 'Toilet', INDIAN_TOILET: 'Indian toilet', WESTERN_TOILET: 'Western toilet', SINK: 'Sink', MIRROR: 'Mirror', BIN: 'Bin', FLOOR: 'Floor zone', CUSTOM: 'Fixture' };
export function validateInventorySelection(area: Pick<Area, 'id' | 'items'>, mode: 'ALL' | 'SUBSET', selected: InventorySelection[]): string | null {
  const active = area.items.filter(item => item.status === 'ACTIVE');
  if (selected.some(row => !active.some(item => item.id === row.areaItemId && item.areaId === area.id))) return 'Choose active items from this area only.';
  if (new Set(selected.map(row => row.areaItemId)).size !== selected.length) return 'An item can only be selected once.';
  const mandatory = active.filter(item => mode === 'ALL' ? selected.find(row => row.areaItemId === item.id)?.mandatory !== false : selected.some(row => row.areaItemId === item.id && row.mandatory));
  if (!mandatory.length) return 'Choose at least one mandatory item.';
  if (mandatory.some(item => !item.requiredViews.some(view => view.mandatory !== false))) return 'A mandatory fixture requires at least one mandatory view.';
  return null;
}

export function itemEditPayload(item: AreaItem, expectedInventoryVersion: number) {
  return { displayName: item.displayName.trim(), positionHint: item.positionHint,
    sequence: item.sequence, identificationMode: item.identificationMode,
    existingNumber: item.identificationMode === 'EXISTING_NUMBER' ? item.existingNumber?.trim() || null : null,
    status: item.status, expectedInventoryVersion };
}
export function inventorySummary(area: Pick<Area, 'items'>, mode: 'ALL' | 'SUBSET', selected: InventorySelection[]) {
  const items = area.items.filter(item => item.status === 'ACTIVE' && (mode === 'ALL' || selected.some(row => row.areaItemId === item.id)));
  const mandatory = items.filter(item => selected.find(row => row.areaItemId === item.id)?.mandatory !== false);
  return { total: items.length, mandatory: mandatory.length, optional: items.length - mandatory.length,
    requiredViews: mandatory.reduce((sum, item) => sum + item.requiredViews.filter(view => view.mandatory !== false).length, 0) };
}
export const setupFixtureTypes: FixtureType[] = ['INDIAN_TOILET', 'WESTERN_TOILET', 'SINK', 'MIRROR', 'BIN', 'FLOOR'];
export function previewInventoryCounts(counts: InventoryCount[], existing: Pick<AreaItem, 'stableCode' | 'sequence'>[] = []) {
  let sequence = Math.max(0, ...existing.map(item => item.sequence));
  const result: Array<{stableCode: string; displayName: string; sequence: number}> = [];
  for (const group of counts) {
    if (!(setupFixtureTypes.includes(group.fixtureType) || group.fixtureType === 'TOILET') || !Number.isSafeInteger(group.count) || group.count < 0 || group.count > 200) throw new Error('Enter whole fixture counts between 0 and 200.');
    let number = Math.max(0, ...[...existing, ...result].filter(item => item.stableCode.startsWith(`${group.fixtureType}-`)).map(item => Number(item.stableCode.split('-')[1]) || 0));
    for (let index = 0; index < group.count; index++) {
      const suffix = String(++number).padStart(2, '0');
      result.push({ stableCode: `${group.fixtureType}-${suffix}`, displayName: `${fixtureNames[group.fixtureType]} ${suffix}`, sequence: ++sequence });
    }
  }
  if (result.length > 200) throw new Error('An area supports at most 200 active fixtures.');
  return result;
}

export function nonRetiredFixtureCount(area: Pick<Area, 'items'>) {
  return area.items.filter(item => item.status === 'ACTIVE' || item.status === 'MAINTENANCE').length;
}
// Presets choose fixture categories, not an assumed room size. Managers enter actual counts.
export const roomPresets = {
  WASHROOM: { fixtureTypes: ['INDIAN_TOILET', 'WESTERN_TOILET', 'SINK', 'MIRROR', 'BIN', 'FLOOR'] as FixtureType[], defaults: {TOILET:0,INDIAN_TOILET:0,WESTERN_TOILET:0,SINK:0,MIRROR:0,BIN:0,FLOOR:1,CUSTOM:0} },
  GENERAL: { fixtureTypes: ['BIN', 'FLOOR'] as FixtureType[], defaults: {TOILET:0,INDIAN_TOILET:0,WESTERN_TOILET:0,SINK:0,MIRROR:0,BIN:0,FLOOR:1,CUSTOM:0} },
};

export function standardPhotoMessage(privacyState?: string): string | null {
  if (privacyState === 'SAFE') return null;
  if (['HOLD', 'HELD', 'PRIVACY_HOLD'].includes(privacyState ?? '')) return 'Photo restricted for privacy review.';
  return 'Photo saved. Privacy review pending.';
}
