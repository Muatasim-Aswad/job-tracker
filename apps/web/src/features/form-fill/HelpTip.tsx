import type { ComponentProps } from "react";
import { Tooltip } from "../../shared/ui/Tooltip";

interface Props extends Pick<ComponentProps<typeof Tooltip>, "children" | "className"> {
  text: string;
}

export function HelpTip({ text, children, className }: Props) {
  return (
    <Tooltip label={text} className={className} toggleOnClick={false}>
      {children}
    </Tooltip>
  );
}
