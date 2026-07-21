import { useLanguage } from "@/i18n/context";
import {
  assignmentLabel,
  taskAssignee,
  type TaskWithWorker,
} from "@/pages/Task/taskAssignee";

export default function TaskWorker({
  task,
  details = false,
}: {
  task: TaskWithWorker;
  details?: boolean;
}) {
  const { t } = useLanguage();
  const { worker, previous, assignment } = taskAssignee(task);
  if (!worker) return <span>{t("Unassigned")}</span>;
  const status = assignmentLabel(assignment?.status);
  return (
    <div className="task-worker">
      <span>{worker.name}</span>
      {details && worker.email ? <p>{worker.email}</p> : null}
      {previous ? (
        <small>
          {t("Previously assigned")}
          {status ? " · " + t(status) : ""}
        </small>
      ) : details && assignment ? (
        <small>{t(assignment.isCurrent ? "Current" : status)}</small>
      ) : null}
    </div>
  );
}
