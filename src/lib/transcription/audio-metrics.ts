import type { AudioJobView } from "@/types/audio-processing";

export function audioProcessingSeconds(
    part: AudioJobView["parts"][number],
): number | null {
    if (!part.startedAt || !part.completedAt) return null;
    const elapsed =
        (Date.parse(part.completedAt) - Date.parse(part.startedAt)) / 1000;
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

export function estimatedAudioCost(
    seconds: number,
    usdPerMinute: number,
): number {
    return (Math.max(0, seconds) / 60) * Math.max(0, usdPerMinute);
}
