import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCurrentBuild,
  runningBuild,
  sameBuild,
  shouldNotifyBuild,
  type BuildInfo,
} from "./buildInfo";
import { toast } from "./toast";

export type BuildCheck =
  | { status: "checking" }
  | { status: "failed" }
  | { status: "checked"; current: BuildInfo };

export function useBuildCheck() {
  const [result, setResult] = useState<BuildCheck>({ status: "checking" });
  const active = useRef<AbortController | null>(null);
  const check = useCallback(() => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setResult({ status: "checking" });
    void fetchCurrentBuild(controller.signal)
      .then((current) => {
        if (controller.signal.aborted) return;
        setResult({ status: "checked", current });
        if (!sameBuild(runningBuild, current) && shouldNotifyBuild(current)) {
          toast.info(
            `A different Job Tracker build (${current.version}) is available. Open About in the menu to check and reload.`,
            0,
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ status: "failed" });
      })
      .finally(() => {
        if (active.current === controller) active.current = null;
      });
  }, []);

  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active.current?.abort();
      active.current = null;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  return { result, check };
}
