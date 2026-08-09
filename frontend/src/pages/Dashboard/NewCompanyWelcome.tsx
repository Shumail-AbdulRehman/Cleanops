import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import SetupPath, { buildSetupSteps } from '@/components/onboarding/SetupPath';
import TaskTicks from '@/components/workspace/TaskTicks';
import OperationsState from '@/pages/Manager/OperationsState';
import { getSetupReadiness } from '@/pages/Setup/api';
import './new-company-v6.css';

/** Overview's no-location variant. The parent decides when to show it (spec 14). */
export function NewCompanyWelcome() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const id = useId();
  const owner = user?.role === 'ADMIN';
  const readiness = useQuery({
    queryKey: ['setup-readiness', user?.companyId, user?.role, user?.id, 0],
    queryFn: ({ signal }) => getSetupReadiness(0, signal),
    enabled: owner,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  if (user?.role === 'MANAGER') {
    return <div className="wx-new-company">
      <PageHeader title="Location overview" />
      <EmptyState icon={<Building2 size={32} />} title="No assigned locations yet"
        message="Ask your company owner to assign a location to your account." />
    </div>;
  }
  if (!owner) return <p role="alert">{t('Owner or assigned-site manager access is required.')}</p>;

  const data = readiness.data;
  // Retain saved progress on a failed background refresh, but fail closed on new work.
  const steps = buildSetupSteps({ selected: data?.sites[0], owner,
    manageWork: readiness.isError ? undefined : data?.access?.manageWork });
  const next = steps.findIndex(step => !step.done);
  const firstName = user.name.trim().split(/\s+/)[0];
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent' }).format(value);

  return <div className="wx-new-company">
    <PageHeader title={firstName ? t('Welcome, {name}', { name: firstName }) : t('Welcome back')}
      subtitle="Your company is ready. Four steps take you to the first working shift."
      action={<Link className="wx-new-company__checklist-link" to="/setup">{t('Open full checklist')}</Link>} />
    <OperationsState loading={readiness.isPending} skeleton="panel" error={readiness.error}
      retry={() => void readiness.refetch()} />
    {data && <div className="wx-new-company__layout">
      <section className="wx-new-company__checklist" aria-labelledby={`${id}-setup`}>
        <h2 id={`${id}-setup`}>{t('Get your company ready')}</h2>
        <p>{next < 0 ? t('Setup is configured for this location. Open Today to inspect its work.')
          : t('Step {step} of 4. Nothing is marked complete until it is saved.', { step: next + 1 })}</p>
        <SetupPath steps={steps} />
      </section>
      <aside className="wx-new-company__preview" aria-labelledby={`${id}-preview`} aria-describedby={`${id}-example`}>
        <h2 id={`${id}-preview`}>{t('What this page becomes')}</h2>
        <p>{t('Once your first shift runs, you’ll see attendance, submitted work and anything that needs you, right here.')}</p>
        <p id={`${id}-example`} className="wx-new-company__example-label">{t('Example only.')}</p>
        <div className="wx-new-company__example" role="group" aria-labelledby={`${id}-example`}>
          <dl className="wx-new-company__figures">
            <div><dt>{t('Attendance')}</dt><dd><bdi>{percent(0.94)}</bdi></dd></div>
            <div><dt>{t('Work submitted')}</dt><dd><bdi>{percent(0.89)}</bdi></dd></div>
          </dl>
          <dl className="wx-new-company__attention"><dt>{t('Needs attention today')}</dt><dd>{(3).toLocaleString(locale)}</dd></dl>
          <p>{t('Location')}</p>
          <TaskTicks done={10} total={13} />
        </div>
      </aside>
    </div>}
  </div>;
}

export default NewCompanyWelcome;
