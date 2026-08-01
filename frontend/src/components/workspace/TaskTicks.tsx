import { Check } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import "./workspace-parts.css";

export interface TaskTicksProps {
  done: number;
  total: number;
  className?: string;
}

export function TaskTicks({ done, total, className = "" }: TaskTicksProps) {
  const { t } = useLanguage();
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const completed = Number.isFinite(done) ? Math.min(count, Math.max(0, Math.floor(done))) : 0;
  const label = t("{count} of {total} tasks done", { count: completed, total: count });

  return (
    <span className={`wx-task-ticks ${className}`} role="img" aria-label={label}>
      {count > 24 ? (
        <span className="wx-task-ticks__meter" aria-hidden="true">
          <span style={{ inlineSize: `${(completed / count) * 100}%` }} />
        </span>
      ) : (
        <span className="wx-task-ticks__boxes" aria-hidden="true">
          {Array.from({ length: count }, (_, index) => (
            <span key={index} className={`wx-task-ticks__box${index < completed ? " wx-task-ticks__box--done" : ""}`}>
              {index < completed && <Check focusable="false" />}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export default TaskTicks;
