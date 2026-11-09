import { copy } from "./copy";
import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HeaderSearch } from "../../shared/ui/HeaderSearch";

export function CollectionToolbar({
  host,
  children,
}: {
  host?: HTMLElement | null;
  children: ReactNode;
}) {
  const controls = (
    <div
      role="group"
      aria-label={copy.collectionToolbar.filters}
      className="relative flex w-full min-w-0 items-center gap-2"
    >
      {children}
    </div>
  );
  return host ? createPortal(controls, host) : controls;
}

export interface CollectionSearchProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  count: number | null;
  hasNextPage?: boolean;
  loading?: boolean;
  itemName: "question" | "answer";
  maxLength?: number;
  active?: boolean;
  onClear?: () => void;
}

export function CollectionSearch({
  label,
  placeholder,
  value,
  onChange,
  count,
  hasNextPage = false,
  loading = false,
  itemName,
  maxLength,
  active = false,
  onClear,
}: CollectionSearchProps) {
  const id = useId();
  const description = copy.collectionSearch.description(count, loading, itemName, hasNextPage);
  return (
    <HeaderSearch
      label={label}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      maxLength={maxLength}
      count={count == null ? (loading ? "…" : "—") : `${count}${hasNextPage ? "+" : ""}`}
      countLabel={description}
      countId={id}
      active={active || value.trim().length > 0}
      onClear={onClear}
    />
  );
}
