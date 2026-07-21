import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import DeleteButton from './DeleteButton';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));
const scheduleText = "This removes the schedule and today's and future tasks from active work. Past task history and recorded evidence are kept.";

function mount(language: 'en' | 'ur', onDelete: () => Promise<unknown>, preserveHistory = false) {
  localStorage.setItem('hygene-ops.language', language);
  const description = preserveHistory ? scheduleText : 'Synthetic records will be removed.';
  render(<QueryClientProvider client={new QueryClient()}><LanguageProvider>
    <DeleteButton name="Synthetic site" description={description} onDelete={onDelete} preserveHistory={preserveHistory} />
  </LanguageProvider></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

it('shows the trigger, dialog, buttons and accessible label in Urdu', async () => {
  mount('ur', () => Promise.resolve(), true);
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic site حذف کریں' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Synthetic site');
  expect(dialog).toHaveTextContent('حذف کریں؟');
  expect(dialog).toHaveTextContent('پچھلے کاموں کی تاریخ اور درج ثبوت محفوظ رہیں گے۔');
  expect(screen.getByRole('button', { name: 'منسوخ کریں' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'شیڈول حذف کریں' })).toBeInTheDocument();
  expect(dialog).not.toHaveTextContent(/Delete|Cancel/);
});

it('shows the fallback error and the archive path in Urdu', async () => {
  const onDelete = vi.fn().mockRejectedValue({ response: { data: { errors: [{ code: 'EVIDENCE_RETAINED', archivePath: '/location/4/archive' }] } } });
  mount('ur', onDelete);
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic site حذف کریں' }));
  fireEvent.click(await screen.findByRole('button', { name: 'مستقل طور پر حذف کریں' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('یہ ریکارڈ حذف نہیں ہو سکا۔ دوبارہ کوشش کریں۔');
  expect(screen.getByRole('dialog')).toHaveTextContent('آرکائیو کریں؟');
  expect(screen.getByRole('dialog')).toHaveTextContent('تصدیق کی تاریخ اور ثبوت محفوظ رہتے ہیں');
});

it('keeps the English wording, the permanent-delete warning and the pending guard', async () => {
  let finish!: () => void;
  mount('en', () => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Synthetic site' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Synthetic records will be removed. This permanently deletes the records and cannot be undone.');
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  finish();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
