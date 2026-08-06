import { Navigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import { useArea } from './queries';
export default function AreaDetailPage() {
  const {id} = useParams(), {t} = useLanguage();
  const query = useArea(Number(id));
  if (query.isPending) return <p role="status">{t('Loading area template…')}</p>;
  if (!query.data || query.isError) return <div role="alert"><p>{t('Area template could not be loaded.')}</p><Button onClick={() => void query.refetch()}>{t('Retry')}</Button></div>;
  return <Navigate replace to={`/locations/${query.data.locationId}?tab=areas&area=${query.data.id}`} />;
}
