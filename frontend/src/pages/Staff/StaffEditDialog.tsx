import { useEffect, useId, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { Input } from '@/components/ui/input';
import SidePanel, { SidePanelFieldError, SidePanelFooter } from '@/components/workspace/SidePanel';
import { WeekdayPicker } from '@/components/workspace/WeekdayPicker';
import { normalizeDays, type Weekday } from '@/lib/workDays';
import { useEditStaff } from './queries';
import type { EditStaffInput } from './api';
import { checkStaffName, getStaffFormError, staffEmailRules, staffPhoneRules, staffShiftEndRules, staffShiftInputEvents, staffShiftStartRules, staffWorkDaysRules } from './staffFieldRules';
import './staff-forms-v6.css';

export interface EditableStaff {
  id: number;
  name: string;
  email: string | null;
  phone?: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  workDays?: Weekday[];
  isActive: boolean;
  locationId?: number | null;
  location?: { id?: number; name?: string | null } | null;
}
type Props = { person: EditableStaff; timezone: string; onClose: () => void; onSaved?: () => void };
type EditStaffForm = { name: string; email: string; phone: string; shiftStart: string; shiftEnd: string; workDays: Weekday[]; locationId?: string };
const timeValue = (date: string | null, timezone: string) => date ? formatInTimeZone(new Date(date), timezone, 'HH:mm') : '';

export default function StaffEditDialog(props: Props) {
  const { user } = useAuth();
  return <ScopedStaffEditDialog key={`${user?.companyId}:${user?.role}:${user?.id}:${props.person.id}`} {...props} />;
}

function ScopedStaffEditDialog({ person, timezone, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const edit = useEditStaff();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const formId = useId();
  const id = (field: string) => `${formId}-${field}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { register, control, handleSubmit, setError, formState: { errors, defaultValues } } = useForm<EditStaffForm>({
    mode: 'onBlur',
    defaultValues: {
      name: person.name,
      email: person.email ?? '',
      phone: person.phone ?? '',
      shiftStart: timeValue(person.shiftStart, timezone),
      shiftEnd: timeValue(person.shiftEnd, timezone),
      workDays: normalizeDays(person.workDays),
    },
  });
  const shiftStartMessage = errors.shiftStart?.message;
  const shiftEndMessage = errors.shiftEnd?.message;
  const close = () => { if (!edit.isPending && !inFlight.current) onClose(); };
  const save = async (form: EditStaffForm) => {
    if (inFlight.current || !person.isActive) return;
    inFlight.current = true;
    const payload: EditStaffInput = {};
    const name = form.name.trim();
    if (form.name !== person.name && name !== person.name) payload.name = name;
    if (form.email.trim() !== (person.email ?? '')) payload.email = form.email.trim() || null;
    if (form.phone.trim() !== (person.phone ?? '')) payload.phone = form.phone.trim();
    if (form.workDays.join(',') !== defaultValues?.workDays?.join(',')) payload.workDays = form.workDays;
    for (const field of ['shiftStart', 'shiftEnd'] as const) if (form[field] && form[field] !== timeValue(person[field], timezone)) {
      const date = formatInTimeZone(person[field] ? new Date(person[field]!) : new Date(), timezone, 'yyyy-MM-dd');
      payload[field] = fromZonedTime(`${date}T${form[field]}:00`, timezone).toISOString();
    }
    try {
      if (Object.keys(payload).length) await edit.mutateAsync({ id: person.id, data: payload });
      if (!mounted.current) return;
      onSaved?.();
      onClose();
    } catch (cause) {
      if (!mounted.current) return;
      const issue = getStaffFormError(cause);
      if (issue && issue.field !== 'reason') {
        const message = issue.values ? t(issue.message, issue.values) : issue.message;
        setError(issue.field, { type: 'server', message }, { shouldFocus: issue.field === 'workDays' });
        return;
      }
      const status = (cause as { response?: { status?: number } }).response?.status;
      const message = status === 409 ? 'The record changed. Check the email and shift details before saving again. Your draft is kept.'
        : status === 403 ? 'You do not have access to this action. Refresh your assigned sites.'
          : status === 400 ? 'Check the contact and shift details. Existing schedules must fit the shift.'
            : 'The action could not be confirmed. Refresh the record before retrying. Your draft is kept.';
      setError('root.server', { type: 'server', message });
    } finally { inFlight.current = false; }
  };
  const locationId = person.locationId ?? person.location?.id;
  const locationName = person.location?.name || (locationId != null ? `#${locationId}` : t('Unassigned'));
  const actions = <SidePanelFooter className="wx-staff-form-actions">
    <button type="button" className="wx-staff-form-button" disabled={edit.isPending} onClick={close}>{t('Cancel')}</button>
    <button type="submit" form={formId} className="wx-staff-form-button wx-staff-form-primary" disabled={edit.isPending || !person.isActive} aria-busy={edit.isPending}>{t(edit.isPending ? 'Saving…' : 'Save changes')}</button>
  </SidePanelFooter>;
  return <SidePanel open title="Edit team member" description="Times use the assigned site’s timezone." onOpenChange={value => { if (!value) close(); }} footer={actions}>
    <p className="wx-staff-form-person"><bdi>{person.name}</bdi></p>
    <form noValidate id={formId} className="wx-staff-form" onSubmit={event => void handleSubmit(save)(event)} aria-busy={edit.isPending}>
      <fieldset className="wx-staff-form-fields" disabled={edit.isPending}>
        <div className="wx-staff-form-field">
          <label htmlFor={id('name')}>{t('Full Name')}</label>
          <Input id={id('name')} autoComplete="name" required aria-invalid={!!errors.name} aria-describedby={errors.name ? id('name-error') : undefined}
            {...register('name', { validate: value => value === person.name || checkStaffName(value) })} />
          <SidePanelFieldError id={id('name-error')}>{errors.name?.message}</SidePanelFieldError>
        </div>
        <div className="wx-staff-form-pair">
          <div className="wx-staff-form-field">
            <label htmlFor={id('email')}>{t('Email (optional)')}</label>
            <Input id={id('email')} type="email" dir="ltr" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? id('email-error') : undefined}
              {...register('email', staffEmailRules)} />
            <SidePanelFieldError id={id('email-error')}>{errors.email?.message}</SidePanelFieldError>
          </div>
          <div className="wx-staff-form-field">
            <label htmlFor={id('phone')}>{t('Phone Number')}</label>
            <Input id={id('phone')} type="tel" dir="ltr" autoComplete="tel" required aria-invalid={!!errors.phone} aria-describedby={`${id('phone-hint')}${errors.phone ? ` ${id('phone-error')}` : ''}`}
              {...register('phone', staffPhoneRules)} />
            <p id={id('phone-hint')} className="wx-staff-form-help">{t('Changing the phone number signs this person out on every phone.')}</p>
            <SidePanelFieldError id={id('phone-error')}>{errors.phone?.message}</SidePanelFieldError>
          </div>
        </div>
        <div className="wx-staff-form-field">
          <label htmlFor={id('location')}>{t('Location')}</label>
          <Input id={id('location')} readOnly value={locationName} aria-invalid={!!errors.locationId} aria-describedby={`${id('location-hint')}${errors.locationId ? ` ${id('location-error')}` : ''}`} />
          <p id={id('location-hint')} className="wx-staff-form-help">{t('Use Staff access to transfer sites with a reason and open-shift checks.')}</p>
          <SidePanelFieldError id={id('location-error')}>{errors.locationId?.message}</SidePanelFieldError>
          <Link className="wx-staff-form-access" to={`/staff/${person.id}`} aria-disabled={edit.isPending || undefined} onClick={event => { if (edit.isPending || inFlight.current) event.preventDefault(); else onClose(); }}>{t('Staff access')}</Link>
        </div>
        <div className="wx-staff-form-pair">
          {(['shiftStart', 'shiftEnd'] as const).map(field => {
            const message = field === 'shiftStart' ? shiftStartMessage : shiftEndMessage;
            return <div className="wx-staff-form-field" key={field}>
              <label htmlFor={id(field)}>{t(field === 'shiftStart' ? 'Shift Start' : 'Shift End')}</label>
              <Input id={id(field)} type="time" dir="ltr" aria-invalid={!!message} aria-describedby={`${id('timezone-hint')}${message ? ` ${id(`${field}-error`)}` : ''}`}
                {...staffShiftInputEvents(register(field, field === 'shiftStart' ? staffShiftStartRules : staffShiftEndRules))} />
              <SidePanelFieldError id={id(`${field}-error`)}>{message}</SidePanelFieldError>
            </div>;
          })}
        </div>
        <p id={id('timezone-hint')} className="wx-staff-form-help">{t('Times use the assigned site’s timezone.')} <bdi>{timezone}</bdi></p>
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
      {errors.root?.server?.message && <p className="wx-staff-form-error" role="alert">{t(errors.root.server.message)}</p>}
    </form>
  </SidePanel>;
}
