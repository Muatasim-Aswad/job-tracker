import { useCallback, useRef, useState } from "react";
import { Bell, Plus, X } from "lucide-react";
import { IconButton } from "../../shared/ui/IconButton";
import { useFocusTrap, useScrollLock } from "../../shared/useFocusTrap";
import { NotificationList } from "./NotificationList";
import { ReminderForm } from "./ReminderForm";
import { useNotifications } from "./queries";
import { useNotificationTimeZone } from "./useNotificationTimeZone";
import { useNotificationStream } from "./useNotificationStream";
import { copy } from "./copy";

function Inbox({ onClose, onOpenJob }: { onClose: () => void; onOpenJob: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"published" | "scheduled">("published");
  const [adding, setAdding] = useState(false);
  const close = useCallback(() => {
    if (!adding) onClose();
  }, [adding, onClose]);
  useFocusTrap(ref, close);
  useScrollLock();
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-overlay" onClick={close} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-canvas text-ink shadow-2xl outline-none"
      >
        <div className="border-b border-line p-5">
          <div className="flex items-center justify-between">
            <h2 id="notifications-title" className="font-semibold">
              {copy.title}
            </h2>
            <div className="flex items-center gap-1">
              <IconButton label={copy.add} onClick={() => setAdding(true)} className="text-accent">
                <Plus size={17} />
              </IconButton>
              <IconButton label={copy.close} onClick={close}>
                <X size={18} />
              </IconButton>
            </div>
          </div>
          <div className="mt-4 flex gap-4" role="tablist" aria-label={copy.title}>
            {(["published", "scheduled"] as const).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`border-b-2 pb-2 text-sm ${tab === value ? "border-accent font-medium text-accent" : "border-transparent text-ink-muted"}`}
              >
                {value === "published" ? copy.inbox : copy.scheduled}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" role="tabpanel">
          <NotificationList
            state={tab}
            kind={tab === "scheduled" ? "manual_reminder" : undefined}
            onOpenJob={(id) => {
              onClose();
              onOpenJob(id);
            }}
          />
        </div>
        {adding && <ReminderForm onClose={() => setAdding(false)} />}
      </div>
    </div>
  );
}

export function NotificationBell({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const [open, setOpen] = useState(() =>
    new URLSearchParams(window.location.search).has("notification"),
  );
  useNotificationStream();
  useNotificationTimeZone();
  const query = useNotifications("published");
  const count = query.data?.pages[0]?.unread_count ?? 0;
  return (
    <div className="relative ml-auto lg:ml-0">
      <IconButton label={count ? copy.unread(count) : copy.open} onClick={() => setOpen(true)}>
        <Bell size={17} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </IconButton>
      {open && <Inbox onClose={() => setOpen(false)} onOpenJob={onOpenJob} />}
    </div>
  );
}
