import { copy } from "./copy";
import { useRef, useState } from "react";
import { useJobs } from "./queries";
import { toast } from "../../shared/toast";

export function useJobsRefresh() {
  const query = useJobs();
  const { refetch } = query;
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const refreshJobs = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await refetch({ throwOnError: true });
      toast.info(copy.useJobsRefreshMessages.dataRefreshed);
    } catch {
      toast.error(copy.useJobsRefreshMessages.couldntRefreshDataCheckYourConnectionAndTryAgain);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  };

  return { query, refreshing, refreshJobs };
}
