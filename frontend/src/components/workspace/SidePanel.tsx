import { useContext, useRef, type ComponentProps, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { WorkspaceTheme } from "@/components/common/WorkspaceTheme";
import { useLanguage } from "@/i18n/context";
import { cn } from "@/lib/utils";
import "./side-panel.css";

export interface SidePanelProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  open: boolean;
  /** Keep open unchanged to refuse dismissal, for example while saving. */
  onOpenChange: (open: boolean) => void;
}

export function SidePanel({ title, description, children, footer, wide = false, open, onOpenChange }: SidePanelProps) {
  const workspace = useContext(WorkspaceTheme);
  const { t, language } = useLanguage();
  const returnFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dir = language === "ur" ? "rtl" : "ltr";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <div className="workspace wx-side-panel-portal" dir={dir} lang={language === "ur" ? "ur-PK" : "en-PK"}>
          <DialogPrimitive.Overlay className="wx-side-panel-scrim" />
          <DialogPrimitive.Content
            className={cn("wx-side-panel", wide && "wx-side-panel-wide", workspace && "workspace-dialog")}
            dir={dir}
            aria-modal="true"
            {...(description ? {} : { "aria-describedby": undefined })}
            onOpenAutoFocus={event => {
              // This controlled panel has no Radix Trigger: retain the actual opener.
              returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              event.preventDefault();
              heading.current?.focus();
            }}
            onCloseAutoFocus={event => {
              event.preventDefault();
              if (returnFocus.current?.isConnected) returnFocus.current.focus();
            }}
          >
            <header className="wx-side-panel-header">
              <div className="wx-side-panel-heading">
                <DialogPrimitive.Title className="wx-side-panel-title" ref={heading} tabIndex={-1}>{t(title)}</DialogPrimitive.Title>
                {description && <DialogPrimitive.Description className="wx-side-panel-description">{t(description)}</DialogPrimitive.Description>}
              </div>
              <DialogPrimitive.Close className="wx-side-panel-close" aria-label={t("Close")}>
                <X aria-hidden="true" />
              </DialogPrimitive.Close>
            </header>
            <div className="wx-side-panel-body">{children}</div>
            {footer != null && <footer className="wx-side-panel-footer">{footer}</footer>}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type SidePanelFooterProps = ComponentProps<"div">;

/** A wrapping action row; the panel supplies its sticky footer container. */
export function SidePanelFooter({ className, ...props }: SidePanelFooterProps) {
  return <div className={cn("wx-side-panel-footer-row", className)} {...props} />;
}

export interface SidePanelFieldErrorProps extends Omit<ComponentProps<"p">, "children"> {
  /** Reference this id from the field's aria-describedby. */
  id: string;
  children?: string | null;
}

export function SidePanelFieldError({ children, className, ...props }: SidePanelFieldErrorProps) {
  const { t } = useLanguage();
  if (!children?.trim()) return null;
  return <p {...props} className={cn("wx-side-panel-field-error", className)} role="alert">{t(children)}</p>;
}

export default SidePanel;
