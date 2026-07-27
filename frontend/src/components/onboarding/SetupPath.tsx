import { useId } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import StatusPill from '@/components/workspace/StatusPill';
import type { SetupSite } from '@/pages/Setup/api';
import './setup-path.css';

export interface SetupPathStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  allowed: boolean;
  href: string;
  action: string;
  hint?: string;
  disabledReason?: string;
  /** False keeps review navigation quiet when new-work access is unavailable. */
  primary?: boolean;
}

export interface BuildSetupStepsInput {
  selected?: SetupSite | null;
  owner: boolean;
  manageWork?: boolean;
}

/** Saved readiness and server access only; never infer access from billing. */
// Spec 12 co-locates this pure helper with the shared list for its two consumers.
// eslint-disable-next-line react-refresh/only-export-components
export function buildSetupSteps({ selected, owner, manageWork }: BuildSetupStepsInput): SetupPathStep[] {
  const canManage = manageWork === true;
  const siteLink = selected ? `/locations/${selected.id}` : '/locations';
  const teamLink = selected ? `/staff?locationId=${selected.id}` : '/staff';
  // Keep SetupPage's wording, links and prerequisites together for both consumers.
  const steps: SetupPathStep[] = [
    { id: 'location', title: 'Create a location', description: 'Set the site name, timezone and check-in area.', done: !!selected, href: selected ? siteLink : '/locations?create=1', action: selected ? 'Review location' : 'Add location', allowed: !!selected || (owner && canManage) },
    { id: 'team', title: 'Add staff and a shift', description: 'Assign staff to this location and confirm their working hours.', done: !!selected && selected.counts.staffWithShift > 0, href: teamLink, action: 'Open team and shifts', allowed: !!selected },
    { id: 'area', title: 'Prepare an area template', description: 'Name the fixtures and required photo views.', done: !!selected && selected.counts.activeAreas > 0, href: siteLink + '?tab=areas' + (selected?.counts.activeAreas ? '' : '&newArea=1'), action: selected?.counts.activeAreas ? 'Review area templates' : 'Add area template', allowed: !!selected },
    { id: 'schedule', title: 'Create the first schedule', description: 'Use the existing daily or one-time schedule.', done: !!selected && selected.counts.readySchedules > 0, href: siteLink + '?tab=templates' + (selected?.counts.readySchedules ? '' : '&newSchedule=1'), action: selected?.counts.readySchedules ? 'Review cleaning schedules' : 'Add cleaning schedule', allowed: !!selected && selected.counts.staffWithShift > 0 && selected.counts.activeAreas > 0 },
  ];
  const accessReason = manageWork !== false
    ? 'New-work access is unavailable'
    : owner
      ? 'This workspace is read-only for new work. Review plan activation to add or change setup.'
      : 'This workspace is read-only for new work. Ask your company owner to review plan activation.';
  const locationReason = owner
    ? 'Create a location to begin. Nothing is marked complete until it is saved.'
    : 'Ask your owner to assign a location before setting up its team or schedules.';

  return steps.map(step => {
    const mutation = !step.done && step.id !== 'team';
    const available = step.allowed && (!mutation || canManage);
    return {
      ...step,
      allowed: available,
      primary: canManage,
      hint: step.id === 'team' && selected && !step.done
        ? 'Use Edit on an existing team member to add their shift.'
        : step.id === 'schedule' && !step.allowed && !canManage
          ? 'Prepare an area template and a staff shift first.' : undefined,
      disabledReason: available ? undefined : !canManage ? accessReason
        : step.id === 'schedule' ? 'Prepare an area template and a staff shift first.' : locationReason,
    };
  });
}

export interface SetupPathProps {
  steps: readonly SetupPathStep[];
  className?: string;
}

export function SetupPath({ steps, className = '' }: SetupPathProps) {
  const { t } = useLanguage();
  const id = useId();
  const next = steps.findIndex(step => !step.done);

  return (
    <ol className={`wx-setup-path ${className}`} aria-label={t('Your setup checklist')}>
      {steps.map((step, index) => {
        const current = index === next;
        const primary = current && step.allowed && step.primary !== false;
        const reasonId = `${id}-${index}-reason`;
        return (
          <li key={step.id} className={`wx-setup-path__step${step.done ? ' wx-setup-path__step--done' : ''}${primary ? ' wx-setup-path__step--next' : ''}`} aria-current={current ? 'step' : undefined}>
            <span className="wx-setup-path__box" aria-hidden="true">
              {step.done ? <Check size={18} focusable="false" /> : index + 1}
            </span>
            <div className="wx-setup-path__copy">
              <h3>{t(step.title)}</h3>
              <p>{t(step.description)}</p>
              <span className="wx-setup-path__status">
                <StatusPill tone={step.done ? 'ok' : 'neutral'}>{step.done ? 'Configured' : 'Not configured'}</StatusPill>
              </span>
              {step.hint && <p className="wx-setup-path__hint">{t(step.hint)}</p>}
              {!step.allowed && <p id={reasonId} className="wx-setup-path__hint">{t(step.disabledReason || 'New-work access is unavailable')}</p>}
            </div>
            {step.allowed ? (
              <Link className={`wx-setup-path__action${primary ? ' wx-setup-path__action--primary' : ''}`} to={step.href}>
                {t(step.action)}<ArrowRight size={16} aria-hidden="true" focusable="false" />
              </Link>
            ) : (
              <button type="button" className="wx-setup-path__action" disabled aria-describedby={reasonId}>{t(step.action)}</button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default SetupPath;
