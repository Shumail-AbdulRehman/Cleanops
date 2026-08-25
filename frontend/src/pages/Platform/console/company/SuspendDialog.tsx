import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useLanguage } from '@/i18n/context';
import { setCompanyStatus, type CompanySummary } from '../../companyApi';
import { operatorQueryScope } from '../../operatorSession';
import './company-header.css';

export type ConfirmedStatusChange = {
  company: CompanySummary;
  reason: string;
};

type SuspendDialogProps = {
  company: Pick<CompanySummary, 'id' | 'name' | 'operationalStatus' | 'accountVersion'>;
  onDismiss: () => void;
  onSuccess: (result: ConfirmedStatusChange) => void;
  onCloseAutoFocus: (event: Event) => void;
};

const maxReasonLength = 500;

export function SuspendDialog({ company, onDismiss, onSuccess, onCloseAutoFocus }: SuspendDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const reasonHintId = useId();
  const [reason, setReason] = useState('');
  const trimmedReason = reason.trim();
  const invalidReason = Array.from(trimmedReason).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  const suspending = company.operationalStatus === 'ACTIVE';
  const change = useMutation({
    mutationFn: (reason: string) => setCompanyStatus(company.id, {
      operationalStatus: suspending ? 'SUSPENDED' : 'ACTIVE',
      expectedVersion: company.accountVersion,
      reason,
    }),
    onSuccess: async (result, submittedReason) => {
      await queryClient.invalidateQueries({ queryKey: operatorQueryScope });
      onSuccess({ company: result.company, reason: submittedReason });
    },
  });
  const conflict = change.error && 'status' in change.error && change.error.status === 409;
  const canSubmit = trimmedReason.length > 0 && !invalidReason && !change.isPending && !conflict;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) change.mutate(trimmedReason);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !change.isPending) onDismiss(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="workspace px-company-dialog-backdrop" />
        <Dialog.Content
          className="workspace px-company-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Dialog.Title>
            {t(suspending ? 'Suspend {company}?' : 'Reactivate {company}?', { company: company.name })}
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="px-company-dialog__description">
              {suspending ? (
                <>
                  <p>{t('While the account is suspended')}</p>
                  <ul>
                    <li>{t('Owner, managers and staff can still sign in, see billing and change their own password.')}</li>
                    <li>{t('They cannot open records, start or finish tasks, or check in.')}</li>
                    <li>{t('Paddle keeps billing them.')}</li>
                  </ul>
                </>
              ) : (
                <p>{t('Reactivation restores access according to the company’s plan and billing status.')}</p>
              )}
            </div>
          </Dialog.Description>
          <form onSubmit={submit} aria-busy={change.isPending}>
            <label htmlFor={reasonId}>{t('Reason')}</label>
            <textarea
              id={reasonId}
              rows={3}
              required
              maxLength={maxReasonLength}
              readOnly={change.isPending}
              aria-invalid={invalidReason || undefined}
              aria-describedby={reasonHintId}
              placeholder={t(suspending
                ? 'For example, the owner asked to pause the account'
                : 'For example, the owner requested reactivation')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id={reasonHintId} className="px-company-dialog__hint">
              {t(invalidReason ? 'Enter the reason on one line.' : 'Saved in the platform history with today’s date.')}
            </p>
            {change.isError && (
              <p className="px-company-dialog__error" role="alert">
                {t(conflict
                  ? 'This company changed. Reload before trying again.'
                  : 'Could not update the company account. Try again.')}
              </p>
            )}
            <div className="px-company-actions">
              <Dialog.Close className="px-company-button" disabled={change.isPending}>{t('Cancel')}</Dialog.Close>
              <button
                type="submit"
                className={`px-company-button ${suspending ? 'px-company-button--danger-solid' : 'px-company-button--primary'}`}
                disabled={!canSubmit}
              >
                {t(change.isPending ? 'Saving…' : suspending ? 'Suspend company' : 'Reactivate')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
