import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n/translations';
import {
  checkStaffEmail,
  checkStaffName,
  checkStaffPhone,
  checkStaffReason,
  checkStaffShift,
  checkStaffSite,
  getStaffFormError,
  staffEmailRules,
  staffNameRules,
  staffPhoneRules,
  staffReasonRules,
  staffShiftEndRules,
  staffShiftStartRules,
  staffSiteRules,
} from './staffFieldRules';

const invalidPhone = 'Enter a Pakistan mobile number, like 03001234567.';
const invalidEmail = 'Enter a valid email, like name@example.com.';
const shiftPair = 'Enter both shift start and shift end.';
const shiftDifferent = 'Shift start and end must be different.';

describe('staff form field checks', () => {
  it.each(['0300 123-4567', '300 123-4567', '92300 123-4567', '+92 (300) 123-4567', '0092 [300] 123-4567'])(
    'accepts Pakistan mobile format %s',
    phone => expect(checkStaffPhone(phone)).toBe(true),
  );

  it.each(['042 12345678', '+44 7700 900123', '0300 123-ABCD', '0300123456'])(
    'rejects non-mobile or malformed number %s',
    phone => expect(checkStaffPhone(phone)).toBe(invalidPhone),
  );

  it('reports a missing phone separately from a formatted but invalid phone', () => {
    expect(checkStaffPhone('   ')).toBe('Phone number is required.');
    expect(checkStaffPhone(' - () ')).toBe(invalidPhone);
  });

  it('allows trimmed English and Urdu names with punctuation and vowel marks', () => {
    expect(checkStaffName("  A. O'Neill-Smith  ")).toBe(true);
    expect(checkStaffName('مُحَمَّد علی')).toBe(true);
  });

  it('reports missing, short, long and invalid names', () => {
    expect(checkStaffName('  ')).toBe('Full name is required.');
    expect(checkStaffName(' A ')).toBe('Enter a name between 2 and 150 characters.');
    expect(checkStaffName('a'.repeat(151))).toBe('Enter a name between 2 and 150 characters.');
    expect(checkStaffName('a'.repeat(150))).toBe(true);
    expect(checkStaffName('Ali 2')).toBe('Use letters only in the name.');
    expect(checkStaffName('---')).toBe('Use letters only in the name.');
  });

  it('accepts a blank email or one address within 254 characters', () => {
    expect(checkStaffEmail('   ')).toBe(true);
    expect(checkStaffEmail('  first.last+staff@example.com  ')).toBe(true);
    const domain = `${'b'.repeat(62)}.${'c'.repeat(62)}.${'d'.repeat(60)}.com`;
    expect(checkStaffEmail(`${'a'.repeat(63)}@${domain}`)).toBe(true);
    expect(checkStaffEmail(`${'a'.repeat(64)}@${domain}`)).toBe(invalidEmail);
    expect(checkStaffEmail('name.example.com')).toBe(invalidEmail);
    expect(checkStaffEmail('one@example.com,two@example.com')).toBe(invalidEmail);
  });

  it('requires a site selection for managers', () => {
    expect(checkStaffSite('', true)).toBe('Choose a site.');
    expect(checkStaffSite('12', true)).toBe(true);
    expect(checkStaffSite(undefined, false)).toBe(true);
  });

  it('allows empty shifts and distinct times, including overnight shifts', () => {
    expect(checkStaffShift('', '')).toBeUndefined();
    expect(checkStaffShift('22:00', '06:00')).toBeUndefined();
  });

  it('assigns shift errors to the missing field or to the end field for equal times', () => {
    expect(checkStaffShift('08:00', '')).toEqual({ field: 'shiftEnd', message: shiftPair });
    expect(checkStaffShift('', '08:00')).toEqual({ field: 'shiftStart', message: shiftPair });
    expect(checkStaffShift('08:00', '08:00')).toEqual({ field: 'shiftEnd', message: shiftDifferent });
  });

  it('requires a trimmed reason of up to 1000 characters', () => {
    expect(checkStaffReason('  ')).toBe('Enter a reason.');
    expect(checkStaffReason(' a ')).toBe(true);
    expect(checkStaffReason(` ${'a'.repeat(1000)} `)).toBe(true);
    expect(checkStaffReason('a'.repeat(1001))).toBe('Keep the reason under 1000 characters.');
  });
});

describe('staff form server errors', () => {
  it.each([
    ['PHONE_IN_USE', 'phone', 'This phone number is already used by another staff member.'],
    ['EMAIL_IN_USE', 'email', 'This email is already used by another staff member.'],
    ['INVALID_PHONE', 'phone', invalidPhone],
  ])('maps %s to its field and friendly message', (code, field, message) => {
    expect(getStaffFormError({ response: { data: { errors: [{ code }] } } })).toEqual({ field, message });
  });

  it('uses the supported field and the server message from a validation issue', () => {
    const issue = { field: 'shiftEnd', message: 'Shift end must be a valid date' };
    expect(getStaffFormError({ response: { data: { errors: [{ code: 'INVALID_REQUEST' }, issue] } } }))
      .toEqual(issue);
    expect(getStaffFormError({ response: { data: { code: 'INVALID_REQUEST', errors: [issue] } } }))
      .toEqual(issue);
  });

  it('leaves unknown errors, unsupported fields and transport messages to the general form error', () => {
    const message = 'Request failed with status code 409';
    expect(getStaffFormError({ message })).toBeUndefined();
    expect(getStaffFormError({ message, response: { data: { errors: [{ code: 'CAPACITY_REACHED' }] } } }))
      .toBeUndefined();
    expect(getStaffFormError({ response: { data: { code: 'INVALID_REQUEST', errors: [{ field: 'password', message }] } } }))
      .toBeUndefined();
  });
});

describe('staff form message translations', () => {
  it.each([
    'Full name is required.',
    'Enter a name between 2 and 150 characters.',
    'Use letters only in the name.',
    'Phone number is required.',
    invalidPhone,
    invalidEmail,
    'Choose a site.',
    shiftPair,
    shiftDifferent,
    'Enter a reason.',
    'Keep the reason under 1000 characters.',
    'This phone number is already used by another staff member.',
    'This email is already used by another staff member.',
  ])('translates %s to Urdu', message => {
    expect(translate(message, 'en')).toBe(message);
    expect(translate(message, 'ur')).toMatch(/\p{Script=Arabic}/u);
  });
});

type TestForm = {
  name: string;
  phone: string;
  email: string;
  locationId?: string;
  shiftStart: string;
  shiftEnd: string;
  reason: string;
};

function StaffForm({ onSubmit }: { onSubmit: (values: TestForm) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<TestForm>();
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>Full name <input {...register('name', staffNameRules)} /></label>
      <label>Phone number <input {...register('phone', staffPhoneRules)} /></label>
      <label>Email <input {...register('email', staffEmailRules)} /></label>
      <label>Site <select {...register('locationId', staffSiteRules(true))}>
        <option value="">Choose a site</option>
        <option value="12">Main site</option>
      </select></label>
      <label>Shift start <input type="time" {...register('shiftStart', staffShiftStartRules)} /></label>
      <label>Shift end <input type="time" {...register('shiftEnd', staffShiftEndRules)} /></label>
      <label>Reason <input {...register('reason', staffReasonRules)} /></label>
      {Object.values(errors).map(error => <p role="alert" key={error.message}>{error.message}</p>)}
      <button type="submit">Save</button>
    </form>
  );
}

it('registers the rules directly, reports an incomplete shift and submits trimmed values once valid', async () => {
  const onSubmit = vi.fn();
  render(<StaffForm onSubmit={onSubmit} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), { target: { value: '  علی احمد  ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: ' 0300 1234567 ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: '  ' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('Shift start'), { target: { value: '08:00' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: ' Updated phone ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect((await screen.findByRole('alert')).textContent).toBe(shiftPair);
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Shift end'), { target: { value: '16:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSubmit.mock.calls[0]?.[0]).toEqual({
    name: 'علی احمد',
    phone: '0300 1234567',
    email: '',
    locationId: '12',
    shiftStart: '08:00',
    shiftEnd: '16:00',
    reason: 'Updated phone',
  }));
});
