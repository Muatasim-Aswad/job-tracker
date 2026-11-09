import { copy } from "./copy";
import { extensionBuild, type BuildIdentity } from "../version";

export function VersionWarning({ serverBuild }: { serverBuild: BuildIdentity }) {
  const sameVersion = extensionBuild.version === serverBuild.version;
  return (
    <div
      role="status"
      className="mt-2.5 rounded-md border border-popup-warning-border bg-popup-warning-bg px-2.5 py-2 text-xs leading-snug text-popup-warning"
    >
      <p className="font-semibold">
        {sameVersion ? copy.versionWarning.buildMismatch : copy.versionWarning.versionMismatch}
      </p>
      <p className="mt-1">
        {copy.versionWarning.extension}
        {extensionBuild.version}
        {sameVersion && ` (${extensionBuild.revision.slice(0, 7)})`}
        {" · "}
        {copy.versionWarning.server}
        {serverBuild.version}
        {sameVersion && ` (${serverBuild.revision.slice(0, 7)})`}
      </p>
      <p className="mt-1">
        {copy.versionWarning.updateThemToMatchingVersionsAndReloadTheExtension}
      </p>
    </div>
  );
}
