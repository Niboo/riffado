"use client";

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
            <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                {summary}
            </summary>
            <div className="pt-3">{children}</div>
        </details>
    );
}
