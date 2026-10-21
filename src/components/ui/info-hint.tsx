"use client";

import { Info } from "lucide-react";
import { Tooltip } from "radix-ui";
import { type ReactNode, useState } from "react";

export function InfoHint({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Tooltip.Provider delayDuration={150}>
            <Tooltip.Root open={open} onOpenChange={setOpen}>
                <Tooltip.Trigger asChild>
                    <button
                        type="button"
                        aria-label={label}
                        onClick={() => setOpen(!open)}
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                        <Info aria-hidden="true" className="size-4" />
                    </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                    <Tooltip.Content
                        sideOffset={6}
                        collisionPadding={12}
                        className="z-50 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md"
                    >
                        {children}
                    </Tooltip.Content>
                </Tooltip.Portal>
            </Tooltip.Root>
        </Tooltip.Provider>
    );
}
