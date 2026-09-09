import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import useAuth from '@/hooks/useAuth';
import { createCustomerPortalSession, getPricingContext, getSubscription, getBillingLifecycle, getBillingCatalog, getPublicPlanPrices } from './api';

export const subscriptionQueryKey = ['subscription'] as const;
export const billingLifecycleKey = (companyId?:number, ownerId?:number) => ['billing-lifecycle',companyId,ownerId] as const;
export const billingCatalogKey = (companyId?:number, ownerId?:number) => ['billing-catalog',companyId,ownerId] as const;
const privateFamilies = ['subscription', 'billing-lifecycle', 'billing-catalog'];

function useBillingScope() {
 const { user } = useAuth();
 const client = useQueryClient();
 const companyId = user?.companyId, ownerId = user?.id, role = user?.role;
 useEffect(() => {
  // Also runs on first mount so a former principal's unobserved cache cannot survive.
  const obsolete = { predicate: (query: {queryKey: readonly unknown[]}) => privateFamilies.includes(String(query.queryKey[0])) &&
   (query.queryKey[1] !== companyId || query.queryKey[2] !== ownerId || !role || !['ADMIN','MANAGER'].includes(role) || (query.queryKey[0] !== 'subscription' && role !== 'ADMIN')) };
  void client.cancelQueries(obsolete);
  client.removeQueries(obsolete);
 }, [client, companyId, ownerId, role]);
 return { companyId, ownerId, role };
}
export const usePricingContext = () => useQuery({queryKey:['pricing-context'], queryFn:getPricingContext, staleTime:30*60*1000});
export const usePublicPlanPrices = () => useQuery({
 queryKey:['public-plan-prices'], queryFn:({signal})=>getPublicPlanPrices(signal), staleTime:60_000, retry:false,
});
export function useSubscription() {
 const {companyId,ownerId,role} = useBillingScope();
 return useQuery({
  queryKey:[...subscriptionQueryKey,companyId,ownerId],
  queryFn:({signal})=>getSubscription(signal,companyId), enabled:role==='ADMIN'||role==='MANAGER',
  retry:false, gcTime:0, staleTime:0, refetchOnWindowFocus:true,
 });
}
export const useCustomerPortalSession = () => useMutation({mutationFn:createCustomerPortalSession,retry:false,gcTime:0});

function denied(error: unknown) {
 const status = (error as {response?:{status?:number}} | null)?.response?.status;
 return status===401 || status===403;
}

export function useBillingLifecycle() {
 const {companyId,ownerId,role} = useBillingScope();
 const client = useQueryClient();
 const query = useQuery({
  queryKey:billingLifecycleKey(companyId,ownerId), queryFn:({signal})=>getBillingLifecycle(signal,companyId),
  enabled:role==='ADMIN', retry:false, retryOnMount:false, staleTime:0, gcTime:0,
  refetchOnWindowFocus:(query)=>!denied(query.state.error), refetchOnReconnect:(query)=>!denied(query.state.error),
 });
 const refreshBilling = async () => {
  const result=await query.refetch();
  if (!result.isError && client.getQueryData(billingLifecycleKey(companyId,ownerId))===result.data) await client.invalidateQueries({queryKey:billingCatalogKey(companyId,ownerId)});
  return result;
 };
 return {...query,data:role==='ADMIN'?query.data:undefined,refreshBilling,
  dataOwner:role==='ADMIN' && companyId && ownerId ? {companyId,ownerId} : null};
}

/** Catalog READ does not imply purchase permission and is independent of checkout uncertainty. */
export function useBillingCatalog() {
 const {companyId,ownerId,role} = useBillingScope();
 return useQuery({
  queryKey:billingCatalogKey(companyId,ownerId),queryFn:({signal})=>getBillingCatalog(signal),
  enabled:role==='ADMIN',retry:false,staleTime:0,gcTime:0,refetchOnWindowFocus:true,refetchOnReconnect:true,
 });
}
