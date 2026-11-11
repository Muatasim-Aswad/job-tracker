# Job Tracker

Terms for tracking opportunities and the notifications that support follow-up. Architecture and API contracts live in the development guide's authority map.

## Language

**Stale application**: An application in Applied or In process whose recorded inactivity reaches the user's threshold. New qualifying activity starts another inactivity period. _Avoid_: Needs attention, stalled application

**Reminder**: A user-scheduled notification with an optional job association. A reminder without a job applies to the tracker as a whole.

**Notification**: A scheduled or published inbox item, authored by the user as a reminder or generated when an application becomes stale. Delivery and reading are separate acknowledgments.

**Stale notification**: The current automatic alert for one job. It is reused after new activity rather than preserving a history of stale episodes.
