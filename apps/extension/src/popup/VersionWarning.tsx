import { extensionBuild, type BuildIdentity } from "../version";

export function VersionWarning({ serverBuild }: { serverBuild: BuildIdentity }) {
  const sameVersion = extensionBuild.version === serverBuild.version;
  return (
    <div
      role="status"
      className="mt-2.5 rounded-md border border-popup-warning-border bg-popup-warning-bg px-2.5 py-2 text-xs leading-snug text-popup-warning"
    >
      <p className="font-semibold">{sameVersion ? "Build mismatch" : "Version mismatch"}</p>
      <p className="mt-1">
        Extension: {extensionBuild.version}
        {sameVersion && ` (${extensionBuild.revision.slice(0, 7)})`}
        {" · "}
        Server: {serverBuild.version}
        {sameVersion && ` (${serverBuild.revision.slice(0, 7)})`}
      </p>
      <p className="mt-1">Update them to matching versions and reload the extension.</p>
    </div>
  );
}
