import { canLeaveFormFill } from "../form-fill/draftGuard";

export function reloadBuild(reload = () => window.location.reload()): void {
  if (canLeaveFormFill()) reload();
}
