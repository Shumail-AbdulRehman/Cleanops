import { ArrowUpRight, Check, MapPin } from 'lucide-react';
import './auth-preview.css';

const tasks = [
  { time: '09:00', title: 'Reception & lobby', name: 'Sarah M.', initials: 'SM', status: 'Complete', complete: true },
  { time: '10:30', title: 'Meeting rooms', name: 'James W.', initials: 'JW', status: 'In progress', complete: false },
  { time: '12:00', title: 'First-floor washrooms', name: 'Alex T.', initials: 'AT', status: 'Scheduled', complete: false },
];

export default function AuthWorkspacePreview() {
  return <aside className="auth-preview" aria-label="A preview of Hygene Ops">
    <div className="auth-preview-intro">
      <p className="auth-preview-eyebrow"><span /> The everyday, organised.</p>
      <h2>Every shift.<br /><span>All in view.</span></h2>
      <p>Know who’s on site, what’s done, and what needs your attention.</p>
    </div>
    <div className="auth-day" aria-label="Illustrative schedule with sample data">
      <div className="auth-day-header"><div><span className="auth-day-overline">Your workspace</span><h3>Today’s overview</h3></div><span className="auth-day-demo">Preview</span></div>
      <div className="auth-day-location"><span><MapPin size={15} aria-hidden="true" /> Westfield Office</span><span>Morning shift</span></div>
      <ol className="auth-day-tasks">
        {tasks.map(task => <li key={task.time}>
          <time>{task.time}</time>
          <div className="auth-day-task"><h4>{task.title}</h4><span className="auth-day-person"><span>{task.initials}</span>{task.name}</span></div>
          <span className={`auth-task-status ${task.complete ? 'is-complete' : task.status === 'In progress' ? 'is-progress' : ''}`}>{task.complete && <Check size={12} aria-hidden="true" />}{task.status}</span>
        </li>)}
      </ol>
      <div className="auth-day-summary"><span><span className="auth-summary-dot" /> Your team’s day, in one place</span><ArrowUpRight size={16} aria-hidden="true" /></div>
    </div>
    <p className="auth-preview-footer">Less time chasing updates.<br /><strong>More time looking after your team.</strong></p>
  </aside>;
}
