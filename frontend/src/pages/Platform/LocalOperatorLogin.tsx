import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/i18n/context';
import AuthShell from '@/components/common/AuthShell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getLocalOperatorSession, localOperatorLoginEnabled, localSessionKey, operatorQueryScope, signInLocalOperator, signOutLocalOperator } from './operatorSession';
function useSession() { return useQuery({queryKey:localSessionKey,queryFn:getLocalOperatorSession,retry:false,staleTime:0,refetchOnWindowFocus:true,refetchInterval:30_000}); }
export default function LocalOperatorLogin({ security = false, unavailable }: { security?: boolean; unavailable?: ReactNode }) {
  const {language}=useLanguage(), ur=language==='ur';const text=(en:string,urdu:string)=>ur?urdu:en;
  const query=useSession(), client=useQueryClient(), navigate=useNavigate();
  const local = localOperatorLoginEnabled();
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      const session = await signInLocalOperator(email, password);
      setPassword('');
      await client.cancelQueries({ queryKey: localSessionKey });
      client.setQueryData(localSessionKey, { enabled: true, ...session });
      navigate('/platform/overview', { replace: true });
    }
    catch(failure) {setPassword('');const status=(failure as {status?:number}).status;setError(status===429?text('Too many attempts. Try again in 15 minutes.','بہت زیادہ کوششیں ہو چکی ہیں۔ ۱۵ منٹ بعد دوبارہ کوشش کریں۔'):text('Sign-in failed. Check your platform email and password.','داخلہ ناکام ہوا۔ پلیٹ فارم کی ای میل اور پاس ورڈ درست کریں۔'));}
    finally{setBusy(false);}
  }
  async function logout() {
    if(busy)return;setBusy(true);setError('');
    try {await signOutLocalOperator();await client.cancelQueries({queryKey:operatorQueryScope});client.removeQueries({queryKey:operatorQueryScope});navigate('/platform/login',{replace:true});}
    catch{setError(text('Sign out failed. Try again.','خروج ناکام ہوا۔ دوبارہ کوشش کریں۔'));}
    finally{setBusy(false);}
  }
  if (!local && (query.isError || (!query.isPending && !query.data?.enabled))) return unavailable;
  if(query.data?.authenticated&&!security)return <Navigate to="/platform/overview" replace/>;
  return <div className="operator-access"><AuthShell title={text('Platform owner sign-in','پلیٹ فارم مالک کا داخلہ')} subtitle={text('Manage customer companies and platform operations.','کسٹمر کمپنیوں اور پلیٹ فارم کے کاموں کا انتظام کریں۔')} footer={<Link to="/login">{text('Company sign in','کمپنی میں داخلہ')}</Link>}>
    {local && <p className="text-sm text-muted-foreground">{text('Local development access','مقامی ترقیاتی رسائی')}</p>}
    {query.isPending?<p role="status">{text('Checking sign-in…','داخلے کی جانچ جاری ہے…')}</p>:query.isError?<div role="alert"><p>{text('Platform access could not be checked.','پلیٹ فارم کی رسائی کی جانچ نہیں ہو سکی۔')}</p><Button variant="outline" onClick={()=>void query.refetch()}>{text('Retry','دوبارہ کوشش')}</Button></div>:query.data?.authenticated?<div className="space-y-4"><p>{text('Signed in as','داخل شدہ اکاؤنٹ')}: <bdi>{query.data.email}</bdi></p><Button asChild variant="outline"><Link to="/platform/companies">{text('Open companies','کمپنیاں کھولیں')}</Link></Button><Button disabled={busy} onClick={()=>void logout()}>{text('Sign out of platform','پلیٹ فارم سے خارج ہوں')}</Button></div>:!query.data?.enabled?<p role="alert">{text('Local platform sign-in is unavailable.','مقامی پلیٹ فارم میں داخلہ دستیاب نہیں۔')}</p>:<form onSubmit={event=>void submit(event)} className="grid gap-4">
      <label>{text('Platform email','پلیٹ فارم ای میل')}<Input type="email" dir="ltr" autoComplete="username" required maxLength={254} value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
      <label>{text('Password','پاس ورڈ')}<Input type="password" dir="ltr" autoComplete="current-password" required maxLength={72} value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>
      <Button type="submit" disabled={busy}>{busy?text('Signing in…','داخلہ جاری ہے…'):text('Sign in to platform','پلیٹ فارم میں داخل ہوں')}</Button>
    </form>}
    {error?<p role="alert">{error}</p>:null}
  </AuthShell></div>;
}
export function LocalOperatorBoundary({ children, unavailable }: { children: ReactNode; unavailable?: ReactNode }) {
  const session=useSession();const {language}=useLanguage();
  if(session.isPending)return <p role="status">{language==='ur'?'پلیٹ فارم کی رسائی کی جانچ…':'Checking platform access…'}</p>;
  if (!localOperatorLoginEnabled() && (session.isError || !session.data?.enabled)) return unavailable;
  if(!session.data?.authenticated)return <LocalOperatorLogin unavailable={unavailable}/>;
  return <>{children}</>;
}
