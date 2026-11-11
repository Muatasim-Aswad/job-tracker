import { useEffect, useRef } from "react";
import { useRemoveFormFillDetail } from "./queries";

export function usePrivateAnswers(selectedId: string, currentId: string | undefined) {
  const removeDetail = useRemoveFormFillDetail();
  const openedIds = useRef(new Set<string>());
  useEffect(() => {
    if (selectedId) openedIds.current.add(selectedId);
    if (currentId) openedIds.current.add(currentId);
  }, [selectedId, currentId]);
  const clearAnswers = () => {
    for (const id of openedIds.current) removeDetail("answer", id);
  };
  useEffect(
    () => () => {
      for (const id of openedIds.current) removeDetail("answer", id);
    },
    [removeDetail],
  );
  return clearAnswers;
}
