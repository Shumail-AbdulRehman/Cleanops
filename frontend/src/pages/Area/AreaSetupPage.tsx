import { Navigate, useParams } from 'react-router-dom';
export default function AreaSetupPage() {
  const {locationId} = useParams();
  return <Navigate replace to={`/locations/${locationId}?tab=areas&newArea=1`} />;
}
