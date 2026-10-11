import { useId, type ReactNode, type ComponentProps } from "react";
import { SectionHeader } from "./SectionHeader";

export interface SectionDisclosure {
  collapsed: boolean;
  onToggle: () => void;
}

interface Props {
  title: string;
  count?: number;
  help?: string;
  add?: ComponentProps<typeof SectionHeader>["add"];
  disclosure?: SectionDisclosure;
  children: ReactNode;
}

export function CollapsibleSection({ title, count, help, add, disclosure, children }: Props) {
  const id = useId();
  return (
    <section>
      <SectionHeader
        title={title}
        count={count}
        help={help}
        collapse={disclosure && { ...disclosure, controlsId: id }}
        add={
          add && {
            ...add,
            onToggle: () => {
              if (!add.open && disclosure?.collapsed) disclosure.onToggle();
              add.onToggle();
            },
          }
        }
      />
      <div id={id} hidden={disclosure?.collapsed}>
        {children}
      </div>
    </section>
  );
}
