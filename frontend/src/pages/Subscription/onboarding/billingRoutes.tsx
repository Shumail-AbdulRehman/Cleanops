import { Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequireRole } from '@/App';
import { SubscriptionPage } from '@/routes/workspacePages';
import FlowEntry, { FlowEntryStatus } from '@/pages/Onboarding/FlowEntry';
// FlowEntryStatus supplies the existing translated FlowShell / FlowWait billing line.
const billingWait = <FlowEntryStatus pending busy retry={() => undefined} />;
const owner=(page:React.ReactNode)=><RequireRole roles={['ADMIN']}><Suspense fallback={billingWait}>{page}</Suspense></RequireRole>;
/** Mounted beneath App restoration, outside marketing and operational layouts. */
export const billingRoutes:RouteObject[]=[
 {path:'continue',element:<Suspense fallback={billingWait}><FlowEntry/></Suspense>},
 {path:'choose-plan',element:owner(<SubscriptionPage/>)},
 {path:'welcome',element:owner(<SubscriptionPage activationReturn/>)},
 {path:'subscription',element:owner(<SubscriptionPage/>)},
 {path:'subscription/payment',element:owner(<SubscriptionPage/>)},
 {path:'subscription/activation',element:owner(<SubscriptionPage/>)},
 {path:'subscription/recovery',element:owner(<SubscriptionPage/>)},
];
