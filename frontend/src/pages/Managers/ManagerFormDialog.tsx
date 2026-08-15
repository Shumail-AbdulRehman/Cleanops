import './manager-form-v6.css';
import { useId, useRef, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useLanguage } from '@/i18n/context';
import { Input } from '@/components/ui/input';
import SidePanel, { SidePanelFieldError, SidePanelFooter } from '@/components/workspace/SidePanel';
import { useCreateManager, useUpdateManager } from './queries';
import type { Manager, ManagerFormValues } from './types';

interface ManagerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager?: Manager | null;
  locations: { id: number; name: string }[];
  takenLocations?: Map<number, string>;
  onSaved?: () => void;
}

export default function ManagerFormDialog({ open, onOpenChange, manager, locations, takenLocations, onSaved }: ManagerFormDialogProps) {
  const { t } = useLanguage();
  const isEdit = !!manager;
  const formId = useId();
  const id = (field: string) => `${formId}-${field}`;
  const inFlight = useRef(false);
  const createManager = useCreateManager();
  const updateManager = useUpdateManager();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<ManagerFormValues>({
    defaultValues: {
      name: manager?.name ?? '',
      email: manager?.email ?? '',
      password: '',
      locationIds: manager?.locations.map(loc => String(loc.id)) ?? [],
    },
  });
  const isPending = createManager.isPending || updateManager.isPending;
  const nameField = register('name', { required: 'Name is required', minLength: { value: 2, message: 'Name must be at least 2 characters' } });
  const emailField = register('email', { required: 'Email is required' });
  const passwordField = !isEdit ? register('password', { required: 'Password is required', minLength: { value: 8, message: 'Use at least 8 characters' } }) : undefined;
  // Register even when there are no locations, so the required assignment is validated.
  const locationField = register('locationIds', {
    validate: value => value.length >= 1 || 'Assign at least one location',
  });
  const changeOpen = (value: boolean) => {
    if (!isPending && !inFlight.current) onOpenChange(value);
  };
  const onSubmit: SubmitHandler<ManagerFormValues> = async data => {
    if (inFlight.current) return;
    inFlight.current = true;
    setServerError(null);
    const locationIds = data.locationIds.map(Number);
    try {
      if (isEdit && manager) {
        await updateManager.mutateAsync({ id: manager.id, data: { name: data.name.trim(), email: data.email.trim(), locationIds } });
      } else {
        await createManager.mutateAsync({ name: data.name.trim(), email: data.email.trim(), password: data.password, locationIds });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (error: unknown) {
      const response = (error as { response?: { status?: number; data?: { errors?: Array<{ code?: string }> } } }).response;
      const code = response?.data?.errors?.find(issue => issue.code)?.code;
      setServerError(code === 'CAPACITY_REACHED'
        ? 'Your plan’s manager capacity has been reached. Review Plan & billing. Your draft is kept.'
        : code === 'SUBSCRIPTION_REQUIRED'
          ? 'An active subscription is required to add managers. Review Plan & billing. Your draft is kept.'
          : response?.status === 409
            ? 'The record changed or a site is already assigned. Refresh before retrying. Your draft is kept.'
            : response?.status === 403
              ? 'You do not have access to this action. Refresh your assigned sites.'
              : 'The action could not be confirmed. Refresh the record before retrying. Your draft is kept.');
    } finally {
      inFlight.current = false;
    }
  };

  return <SidePanel open={open} onOpenChange={changeOpen} title={isEdit ? 'Edit manager' : 'Add manager'} description="Access follows assigned locations"
    footer={<SidePanelFooter className="wx-manager-form-actions">
      <button type="button" className="wx-manager-form-button" disabled={isPending} onClick={() => changeOpen(false)}>{t('Cancel')}</button>
      <button type="submit" form={formId} className="wx-manager-form-button wx-manager-form-primary" disabled={isPending} aria-busy={isPending}>
        {t(isPending ? isEdit ? 'Saving...' : 'Creating...' : isEdit ? 'Save changes' : 'Create manager')}
      </button>
    </SidePanelFooter>}>
    <form id={formId} className="wx-manager-form" aria-busy={isPending} onSubmit={event => void handleSubmit(onSubmit)(event)}>
      {serverError && <p role="alert" className="wx-manager-form-error">{t(serverError)}</p>}
      <div className="wx-manager-form-field">
        <label htmlFor={id('name')}>{t('Manager Name')}</label>
        <Input id={id('name')} autoComplete="name" disabled={isPending} aria-invalid={!!errors.name} aria-describedby={errors.name ? id('name-error') : undefined}
          {...nameField} />
        <SidePanelFieldError id={id('name-error')}>{errors.name?.message}</SidePanelFieldError>
      </div>
      <div className="wx-manager-form-field">
        <label htmlFor={id('email')}>{t('Email')}</label>
        <Input id={id('email')} type="email" dir="ltr" autoComplete="email" disabled={isPending} aria-invalid={!!errors.email} aria-describedby={errors.email ? id('email-error') : undefined}
          {...emailField} />
        <SidePanelFieldError id={id('email-error')}>{errors.email?.message}</SidePanelFieldError>
      </div>
      {!isEdit ? <div className="wx-manager-form-field">
        <label htmlFor={id('password')}>{t('Password')}</label>
        <Input id={id('password')} type="password" dir="ltr" autoComplete="new-password" disabled={isPending} aria-invalid={!!errors.password} aria-describedby={errors.password ? id('password-error') : undefined}
          {...passwordField} />
        <SidePanelFieldError id={id('password-error')}>{errors.password?.message}</SidePanelFieldError>
      </div> : <p className="wx-manager-form-help">{t('Managers change their own password in Account security. Owner password replacement is unavailable.')}</p>}
      <fieldset className="wx-manager-form-locations" aria-invalid={!!errors.locationIds} aria-describedby={`${id('locations-help')}${errors.locationIds ? ` ${id('locations-error')}` : ''}`}>
        <legend>{t('Assigned Locations')}</legend>
        <p id={id('locations-help')} className="wx-manager-form-help">{t('The manager can only see and manage the locations you select here. A location can only be assigned to one manager.')}</p>
        <div className="wx-manager-form-options">
          {locations.map(loc => {
            const takenBy = takenLocations?.get(loc.id);
            return <label key={loc.id} className="wx-manager-form-option">
              <input type="checkbox" value={loc.id} disabled={!!takenBy || isPending} {...locationField} aria-labelledby={id(`location-${loc.id}`)}
                aria-describedby={takenBy ? id(`owner-${loc.id}`) : undefined} />
              <span id={id(`location-${loc.id}`)} className="wx-manager-form-location-name"><bdi>{loc.name}</bdi></span>
              {takenBy && <span id={id(`owner-${loc.id}`)} className="wx-manager-form-owner"><bdi>{t('Assigned to {name}', { name: takenBy })}</bdi></span>}
            </label>;
          })}
          {!locations.length && <p className="wx-manager-form-empty">{t('You need at least one location before you can create a manager.')}</p>}
        </div>
        <SidePanelFieldError id={id('locations-error')}>{errors.locationIds?.message}</SidePanelFieldError>
      </fieldset>
    </form>
  </SidePanel>;
}
