import { useQuery } from '@tanstack/react-query';
import { getArea, getAreas, getMappingTemplates } from './api';
export const useAreas = (locationId: number) => useQuery({queryKey:['areas',locationId],queryFn:()=>getAreas(locationId),enabled:locationId>0});
export const useArea = (id: number) => useQuery({queryKey:['area',id],queryFn:()=>getArea(id),enabled:id>0});
export const useMappingTemplates = (locationId: number) => useQuery({queryKey:['area-migration',locationId],queryFn:()=>getMappingTemplates(locationId),enabled:locationId>0});
