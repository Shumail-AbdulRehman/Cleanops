import { useEffect, useId, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { fromZonedTime } from 'date-fns-tz';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { Input } from '@/components/ui/input';
import SidePanel, { SidePanelFieldError, SidePanelFooter } from '@/components/workspace/SidePanel';
import SelectMenu from '@/components/workspace/SelectMenu';
import { WeekdayPicker } from '@/components/workspace/WeekdayPicker';
import { isEveryDay, normalizeDays, type Weekday } from '@/lib/workDays';
import { useCreateStaff } from './queries';
import { getStaffFormError, staffEmailRules, staffNameRules, staffPhoneRules, staffShiftEndRules, staffShiftInputEvents, staffShiftStartRules, staffSiteRules, staffWorkDaysRules } from './staffFieldRules';
import './staff-forms-v6.css';

type LocationOption = { id: number; name: string; timezone: string };
interface CreateStaffForm {
  name: string;
  email: string;
  phone: string;
  locationId?: string;
  shiftStart: string;
  shiftEnd: string;
  workDays: Weekday[];
}
type StaffCreateProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations?: LocationOption[];
  location?: LocationOption;
  onSaved?: () => void;
  inline?: boolean;
};

export default function StaffCreateDialog(props: StaffCreateProps) {
  const { user } = useAuth();
  return <ScopedStaffCreateDialog key={`${user?.companyId}:${user?.role}:${user?.id}:${props.location?.id ?? 'directory'}`} {...props} />;
}

function ScopedStaffCreateDialog({ open, onOpenChange, locations = [], location, onSaved, inline = false }: StaffCreateProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const managerHire = user?.role === 'MANAGER';
  const createStaff = useCreateStaff();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const formId = useId();
  const id = (field: string) => `${formId}-${field}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = useForm<CreateStaffForm>({
    mode: 'onBlur',
    defaultValues: { name: '', email: '', phone: '', locationId: location ? String(location.id) : '', shiftStart: '', shiftEnd: '', workDays: normalizeDays() },
  });
  // React Hook Form can update errors in place. Read the messages before mapping the shift inputs.
  const shiftStartMessage = errors.shiftStart?.message;
  const shiftEndMessage = errors.shiftEnd?.message;
  const siteRules = staffSiteRules(managerHire);
  const locationRules = {
    ...siteRules,
    validate: (value: string | undefined) => {
      const selection = location ? String(location.id) : value;
      const result = siteRules.validate(selection);
      if (result !== true) return result;
      return !managerHire || locations.some(site => String(site.id) === selection) || 'Select assigned site';
    },
  };
  const locationErrorId = errors.locationId ? id('location-error') : undefined;
  const onCreateSubmit = (formData: CreateStaffForm) => {
    if (inFlight.current) return;
    const selected = location?.id ?? Number(formData.locationId);
    if (managerHire && !locations.some(site => site.id === selected)) {
      setError('locationId', { type: 'validate', message: 'Select assigned site' });
      return;
    }
    const tz = (location?.id === selected ? location.timezone : locations.find(site => site.id === selected)?.timezone) ?? 'UTC';
    inFlight.current = true;
    createStaff.mutate({
      name: formData.name.trim(),
      ...(formData.email.trim() ? { email: formData.email.trim() } : {}),
      phone: formData.phone.trim(),
      locationId: location?.id ?? (formData.locationId ? Number(formData.locationId) : undefined),
      shiftStart: formData.shiftStart ? fromZonedTime(`1970-01-01T${formData.shiftStart}:00`, tz).toISOString() : undefined,
      shiftEnd: formData.shiftEnd ? fromZonedTime(`1970-01-01T${formData.shiftEnd}:00`, tz).toISOString() : undefined,
      ...(!isEveryDay(formData.workDays) ? { workDays: formData.workDays } : {}),
    }, {
      onSettled: () => { inFlight.current = false; },
      onError: error => {
        const issue = getStaffFormError(error);
        if (mounted.current && issue && issue.field !== 'reason') {
          const message = issue.values ? t(issue.message, issue.values) : issue.message;
          setError(issue.field, { type: 'server', message }, { shouldFocus: issue.field === 'workDays' });
        }
      },
      onSuccess: () => {
        if (!mounted.current) return;
        reset();
        onOpenChange(false);
        onSaved?.();
      },
    });
  };
  const close = () => { if (!createStaff.isPending && !inFlight.current) onOpenChange(false); };
  const cancel = () => { if (!createStaff.isPending && !inFlight.current) { reset(); onOpenChange(false); } };
  const failure = createStaff.error as { response?: { status?: number; data?: { errors?: Array<{ code?: string }> } } } | undefined;
  const failureCode = failure?.response?.data?.errors?.[0]?.code;
  const fieldFailure = getStaffFormError(createStaff.error);
  const failureMessage = failureCode === 'CAPACITY_REACHED'
    ? 'Your plan’s staff capacity has been reached. Ask the company owner to review Plan & billing. Your draft is kept.'
    : failureCode === 'SUBSCRIPTION_REQUIRED'
      ? 'An active subscription is required to add staff. Ask the company owner to review Plan & billing. Your draft is kept.'
      : failure?.response?.status === 403
        ? 'You do not have access to this action. Refresh your assigned sites.'
        : failure?.response?.status === 409
          ? 'The phone number or email is already in use, or the available capacity changed. Your draft is kept.'
          : 'Could not add staff. Check the details and try again. Your draft is kept.';
  const locationLabel = location || managerHire ? 'Location' : 'Location (optional)';
  const actions = <SidePanelFooter className="wx-staff-form-actions">
    <button type="button" className="wx-staff-form-button" disabled={createStaff.isPending} onClick={cancel}>{t('Cancel')}</button>
    <button type="submit" form={formId} className="wx-staff-form-button wx-staff-form-primary" disabled={createStaff.isPending} aria-busy={createStaff.isPending}>{t(createStaff.isPending ? 'Creating...' : 'Create staff')}</button>
  </SidePanelFooter>;
  const body = <form noValidate id={formId} onSubmit={event => void handleSubmit(onCreateSubmit)(event)} className="wx-staff-form" aria-busy={createStaff.isPending}>
    <fieldset disabled={createStaff.isPending} className="wx-staff-form-fields">
      <div className="wx-staff-form-field">
        <label htmlFor={id('name')}>{t('Full Name')}</label>
        <Input id={id('name')} autoComplete="name" required aria-invalid={!!errors.name} aria-describedby={errors.name ? id('name-error') : undefined}
          {...register('name', staffNameRules)} />
        <SidePanelFieldError id={id('name-error')}>{errors.name?.message}</SidePanelFieldError>
      </div>
      <div className="wx-staff-form-pair">
        <div className="wx-staff-form-field">
          <label htmlFor={id('email')}>{t('Email (optional)')}</label>
          <Input type="email" id={id('email')} dir="ltr" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? id('email-error') : undefined}
            {...register('email', staffEmailRules)} />
          <SidePanelFieldError id={id('email-error')}>{errors.email?.message}</SidePanelFieldError>
        </div>
        <div className="wx-staff-form-field">
          <label htmlFor={id('phone')}>{t('Phone Number')}</label>
          <Input type="tel" id={id('phone')} dir="ltr" autoComplete="tel" required aria-invalid={!!errors.phone} aria-describedby={`${id('phone-hint')}${errors.phone ? ` ${id('phone-error')}` : ''}`}
            {...register('phone', staffPhoneRules)} />
          <p id={id('phone-hint')} className="wx-staff-form-help">{t('Staff sign in with this phone number and a code sent by SMS.')}</p>
          <SidePanelFieldError id={id('phone-error')}>{errors.phone?.message}</SidePanelFieldError>
        </div>
      </div>
      <div className="wx-staff-form-field" role={location ? undefined : 'group'} aria-labelledby={location ? undefined : id('location-label')}>
        <label id={id('location-label')} htmlFor={location ? id('location') : undefined}>{t(locationLabel)}</label>
        {location ? <select id={id('location')} disabled aria-invalid={!!errors.locationId} aria-describedby={locationErrorId} {...register('locationId', locationRules)}><option value={location.id}>{location.name}</option></select>
          : <Controller control={control} name="locationId" rules={locationRules} render={({ field }) =>
            <div onBlur={field.onBlur} ref={wrapper => {
              // SelectMenu owns its trigger, so register the button through the wrapper.
              const trigger = wrapper?.querySelector('button');
              if (!trigger) return;
              field.ref(trigger);
              trigger.setAttribute('aria-invalid', String(!!locationErrorId));
              if (locationErrorId) trigger.setAttribute('aria-describedby', locationErrorId);
              else trigger.removeAttribute('aria-describedby');
            }}>
              <SelectMenu label={locationLabel} value={field.value ?? ''} disabled={createStaff.isPending} onChange={field.onChange}
                options={[{ value: '', label: managerHire ? 'Select assigned site' : 'No location' }, ...locations.map(site => ({ value: String(site.id), label: site.name, translateLabel: false }))]} />
            </div>} />}
        <SidePanelFieldError id={id('location-error')}>{errors.locationId?.message}</SidePanelFieldError>
      </div>
      <div className="wx-staff-form-pair">
        {(['shiftStart', 'shiftEnd'] as const).map(field => {
          const message = field === 'shiftStart' ? shiftStartMessage : shiftEndMessage;
          return <div className="wx-staff-form-field" key={field}>
            <label htmlFor={id(field)}>{t(field === 'shiftStart' ? 'Shift Start' : 'Shift End')}</label>
            <Input type="time" dir="ltr" id={id(field)} aria-invalid={!!message} aria-describedby={`${id('timezone-hint')}${message ? ` ${id(`${field}-error`)}` : ''}`}
              {...staffShiftInputEvents(register(field, field === 'shiftStart' ? staffShiftStartRules : staffShiftEndRules))} />
            <SidePanelFieldError id={id(`${field}-error`)}>{message}</SidePanelFieldError>
          </div>;
        })}
      </div>
      <p id={id('timezone-hint')} className="wx-staff-form-help">{t('Times use the assigned site’s timezone.')}</p>
      <Controller control={control} name="workDays" rules={staffWorkDaysRules} render={({ field, fieldState: { error } }) =>
        <div className="wx-staff-form-field" onBlur={field.onBlur} ref={wrapper => {
          const group = wrapper?.querySelector('[role="group"]');
          field.ref(group);
          group?.setAttribute('aria-labelledby', id('work-days-label'));
        }}>
          <label id={id('work-days-label')}>{t('Work days')}</label>
          <WeekdayPicker id={id('workDays')} label="Work days" value={field.value} onChange={field.onChange}
            summaryKind="staff" errorId={error ? id('work-days-error') : undefined} />
          <SidePanelFieldError id={id('work-days-error')}>{error?.message}</SidePanelFieldError>
          <p className="wx-staff-form-help">{t('Days this person comes to work. Shift times are the same on each day.')}</p>
        </div>
      } />
    </fieldset>
    {createStaff.isError && (!fieldFailure || fieldFailure.field === 'reason') && <p role="alert" className="wx-staff-form-error">{t(failureMessage)}</p>}
  </form>;
  if (!open) return null;
  if (inline) return <section className="wx-staff-form-inline" aria-labelledby={id('title')}>
    <header><h2 id={id('title')}>{t('Add team member')}</h2><p className="wx-staff-form-help">{t('Set up a real staff account and its working shift.')}</p></header>
    {body}{actions}
  </section>;
  return <SidePanel open={open} title="Add team member" description="Set up a real staff account and its working shift." onOpenChange={value => { if (!value) close(); }} footer={actions}>{body}</SidePanel>;
}
