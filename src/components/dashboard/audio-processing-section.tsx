"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

export function AudioProcessingSection({
    summary,
    children,
}: {
    summary: ReactNode;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(true);
    return (
        <details
            open={open}
            onToggle={(event) => setOpen(event.currentTarget.open)}
            className="mt-4 border-t pt-3"
        >
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/60 px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <span>{summary}</span>
                <ChevronDown
                    aria-hidden="true"
                    className={`size-4 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                />
            </summary>
            <div className="pt-3">{children}</div>
        </details>
    );
}
