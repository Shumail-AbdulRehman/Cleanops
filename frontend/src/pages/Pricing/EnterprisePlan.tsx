import { isAxiosError } from "axios";
import { client } from "@/api/client";
import { useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import useAuth from '@/hooks/useAuth';

export type InquiryDefaults = { locations: number; staff: number };

export default function EnterprisePlan({ current = false, state = '', inquiry }: { current?: boolean; state?: string; inquiry?: InquiryDefaults }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return <>
    <article className={`hx-plan ${state}`}>
      <div className="hx-plan-title"><h2>Enterprise</h2>{current && <span>Current plan</span>}</div>
      <p>For larger operations. Let’s work out the right fit for your team.</p>
      <button type="button" className="hx-btn hx-btn-line" onClick={() => setOpen(true)}>Contact sales <ArrowUpRight aria-hidden="true" /></button>
    </article>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="hx-sales">
        <div className="hx-sales-side">
          <DialogTitle>Let’s talk about your operation</DialogTitle>
          <DialogDescription>Share a few details so we can discuss an Enterprise plan. This is an inquiry, not a subscription or payment.</DialogDescription>
          <ul>{['Location and team capacity', 'Multi-location operations', 'Your rollout requirements'].map(item => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
        </div>
        <div className="hx-sales-form"><EnterpriseInquiryForm name={user?.name ?? ''} email={user?.email ?? ''} inquiry={inquiry} /></div>
      </DialogContent>
    </Dialog>
  </>;
}

function EnterpriseInquiryForm({ name, email, inquiry }: { name: string; email: string; inquiry?: InquiryDefaults }) {
  const requestId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const payload = useRef<Record<string, string | number> | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    if (!payload.current) payload.current = {
      requestId: requestId.current,
      name: String(form.get('name')).trim(), email: String(form.get('email')).trim(),
      company: String(form.get('company')).trim(), locations: Number(form.get('locations')),
      staff: Number(form.get('staff')), requirements: String(form.get('requirements')).trim(),
    };
    inFlight.current = true; setPending(true); setError('');
    try {
      await client.post('/subscription/enterprise-inquiries', payload.current);
      setSent(true);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 400) {
        payload.current = null;
        setError('Please check your details. All fields are required, and team size and locations must be whole numbers.');
      } else setError('We couldn’t confirm receipt. Please retry; your request will only be saved once.');
    } finally { inFlight.current = false; setPending(false); }
  };
  if (sent) return <div role="status" className="py-6"><h3 className="text-lg font-semibold">Thanks — your inquiry is saved.</h3><p className="mt-2 text-sm text-muted-foreground">Your details are ready for our team to review. Your subscription has not changed.</p></div>;
  return <form className="enterprise-form" onSubmit={submit}>
    <fieldset disabled={pending || !!payload.current} className="grid min-w-0 gap-4 border-0 p-0">
    <div className="grid gap-4 sm:grid-cols-2">
      <label>Your name<input name="name" autoComplete="name" defaultValue={name} required maxLength={100} /></label>
      <label>Work email<input name="email" type="email" autoComplete="email" defaultValue={email} required maxLength={254} /></label>
    </div>
    <label>Company name<input name="company" autoComplete="organization" required maxLength={160} /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label>Number of locations<input name="locations" type="number" min="1" max="1000000" defaultValue={inquiry?.locations} required /></label>
      <label>Team size<input name="staff" type="number" min="1" max="1000000" defaultValue={inquiry?.staff} required /></label>
    </div>
    <label>What does your team need?<textarea name="requirements" rows={4} maxLength={4000} required placeholder="Tell us about your operation and what you’d like to improve." /></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="text-xs leading-5 text-muted-foreground">We’ll use these details to respond to your Enterprise inquiry. Please don’t include passwords or sensitive staff information.</p>
    <Button type="submit" className="hx-btn hx-btn-blue" disabled={pending}>{pending ? "Sending…" : error ? "Retry inquiry" : "Send inquiry"}</Button>
  </form>;
}
