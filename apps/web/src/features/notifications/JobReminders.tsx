import { useState } from "react";
import { CollapsibleSection, type SectionDisclosure } from "../../shared/ui/CollapsibleSection";
import { NotificationList } from "./NotificationList";
import { useNotifications } from "./queries";
import { ReminderForm } from "./ReminderForm";
import { copy } from "./copy";

export function JobReminders({
  jobId,
  disclosure,
}: {
  jobId: string;
  disclosure: SectionDisclosure;
}) {
  const [adding, setAdding] = useState(false);
  const query = useNotifications("scheduled", jobId, "manual_reminder");
  const count = query.data?.pages.reduce((total, page) => total + page.items.length, 0) ?? 0;
  return (
    <CollapsibleSection
      title={copy.reminders}
      help={copy.remindersHelp}
      count={count}
      disclosure={disclosure}
      add={{
        label: copy.add,
        cancelLabel: copy.dismiss,
        open: adding,
        onToggle: () => setAdding((value) => !value),
      }}
    >
      <NotificationList state="scheduled" jobId={jobId} kind="manual_reminder" />
      {adding && <ReminderForm jobId={jobId} onClose={() => setAdding(false)} />}
    </CollapsibleSection>
  );
}
