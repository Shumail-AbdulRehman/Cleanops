import WorkforceActions, { type WorkforceRecord } from '../Staff/WorkforceActions';
// Handover follows the existing single-manager contract: revoke/release, then
// assign released sites using ManagerFormDialog. Each persisted step is explicit.
export default function ManagerAccessActions({manager}:{manager:WorkforceRecord}) {
 return <WorkforceActions person={manager} entity="manager"/>;
}
