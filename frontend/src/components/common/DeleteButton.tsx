import { useQueryClient } from "@tanstack/react-query";
import { client } from "@/api/client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function DeleteButton({
  name,
  description,
  onDelete,
  preserveHistory = false,
}: {
  name: string;
  description: string;
  onDelete: () => Promise<unknown>;
  preserveHistory?: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [archivePath, setArchivePath] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    setPending(true);
    setError("");
    try {
      if (archivePath) {
        await client.post(archivePath);
        await queryClient.invalidateQueries();
      } else {
        await onDelete();
      }
      setOpen(false);
    } catch (cause) {
      const failure = cause as { response?: { data?: { message?: string; errors?: Array<{code?: string; archivePath?: string}> } } };
      const retained = failure.response?.data?.errors?.find(item => item.code === "EVIDENCE_RETAINED");
      if (retained?.archivePath && /^\/(location|staff|manager|task-template)\/[1-9]\d*\/archive$/.test(retained.archivePath)) {
        setArchivePath(retained.archivePath);
      }
      const message = failure.response?.data?.message;
      setError(t(message || "Could not delete this record. Please try again."));
    } finally {
      setPending(false);
    }
  };
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) {
            setOpen(value);
            setError("");
            setArchivePath("");
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" aria-label={t("Delete {name}", { name })}>
            <Trash2 size={14} aria-hidden="true" />
            {t("Delete")}
          </Button>
        </DialogTrigger>
        <DialogContent
          className="bg-card sm:max-w-lg"
          showCloseButton={!pending}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement)
              .querySelector<HTMLButtonElement>("[data-cancel-delete]")
              ?.focus();
          }}
        >
          <DialogTitle>{t(archivePath ? "Archive {name}?" : "Delete {name}?").split("{name}").map((part, i) => i ? <span key={i}><bdi>{name}</bdi>{part}</span> : part)}</DialogTitle>
          <DialogDescription>
            {archivePath ? t("Archiving keeps verification history and evidence. This record will become inactive.") : preserveHistory ? t(description) : t("{description} This permanently deletes the records and cannot be undone.", { description: t(description) })}
          </DialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              data-cancel-delete
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button variant="destructive" disabled={pending} onClick={remove}>
              {t(pending ? (archivePath ? "Archiving…" : "Deleting…") : (archivePath ? "Archive and preserve history" : preserveHistory ? "Delete schedule" : "Delete permanently"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
