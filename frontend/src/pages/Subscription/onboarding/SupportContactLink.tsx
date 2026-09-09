import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import { getPublicSupport } from '@/lib/serviceInformation';

/** Shows Contact support only when the server has a support email configured. */
export default function SupportContactLink({ className }: { className: string }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getPublicSupport(controller.signal).then(support => setEmail(support.email)).catch(() => {});
    return () => controller.abort();
  }, []);
  if (!email) return null;
  return <Button asChild className={className}><a href={`mailto:${email}`}>{t('Contact support')}</a></Button>;
}
