import { client } from '@/api/client';
import type { Area, AreaItem, InventoryCount, InventorySelection, StandardPhoto } from './types';
export const getAreas = async (locationId: number) => (await client.get<{data: Area[]}>(`/location/${locationId}/areas`)).data.data;
export const getArea = async (id: number) => (await client.get<{data: Area & {taskTemplates?: Area['templates']; affectedTemplates?: Area['templates']}}>(`/area/${id}`)).data.data;
export const createArea = async (locationId: number, input: {name: string; roomType: string; counts: InventoryCount[]; layoutInstructions?: string}) => (await client.post<{data: Area}>(`/location/${locationId}/areas`, input)).data.data;
export const editArea = async (id: number, input: {expectedInventoryVersion: number; name?: string; layoutInstructions?: string; status?: string}) => (await client.patch(`/area/${id}`, input)).data.data;
export const addItems = async (id: number, counts: InventoryCount[], expectedInventoryVersion: number) => (await client.post(`/area/${id}/items/bulk`, {counts, expectedInventoryVersion})).data.data;
export const editItem = async (areaId: number, itemId: number, input: Partial<AreaItem> & {expectedInventoryVersion: number}) => (await client.patch(`/area/${areaId}/items/${itemId}`, input)).data.data;
export const archiveArea = async (id: number, expectedInventoryVersion: number) => (await client.post(`/area/${id}/archive`, {expectedInventoryVersion})).data.data;
export const getStandards = async (id: number) => (await client.get<{data: StandardPhoto[]}>(`/area/${id}/standards`)).data.data;
export const retryStandardPrivacy = async (id: number, standardId: number) => (await client.post<{data: StandardPhoto}>(`/area/${id}/standards`, {standardId})).data.data;
export const uploadStandard = async (id: number, photo: File, caption: string, areaItemId?: number) => {
  const body = new FormData(); body.append('photo', photo); body.append('caption', caption); if (areaItemId) body.append('areaItemId', String(areaItemId));
  return (await client.post(`/area/${id}/standards`, body)).data.data;
};
export type MigrationTemplate = {id: number; title: string; locationId: number; location?: {name: string; timezone?: string}; referenceImages?: Array<{name: string}>; staffId?: number | null; staff?: {name: string} | null; _count?: {instances: number}; shiftStart?: string | null; shiftEnd?: string | null; activeInstanceCount?: number; setupStatus?: string; areaId?: number | null; inventorySelection?: 'ALL' | 'SUBSET'; inventoryItems?: InventorySelection[]};
export const getMappingTemplates = async (locationId: number) => (await client.get<{data: MigrationTemplate[]}>(`/area/migration/templates`, {params:{locationId}})).data.data;
export const mapTemplate = async (id: number, input: {areaId: number; inventorySelection:'ALL'|'SUBSET'; selectedItems: InventorySelection[]; expectedInventoryVersion: number}) => (await client.post(`/task-template/${id}/map-inventory`, input)).data.data;
export function apiMessage(error: unknown): string { const value = error as {response?:{data?:{message?: string}};message?: string}; return value.response?.data?.message ?? value.message ?? 'Could not save. Try again.'; }
