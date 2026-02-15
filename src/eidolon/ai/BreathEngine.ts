export interface PhaseDurations {
    inhale: number;
    holdIn: number;
    exhale: number;
    holdOut: number;
}

export enum BreathPhase {
    Inhale = "Inhale",
    HoldIn = "HoldIn",
    Exhale = "Exhale",
    HoldOut = "HoldOut"
}

export class BreathEngine {
    private currentPhase: BreathPhase = BreathPhase.Inhale;
    private phaseTimer: number = 0;
    private durations: PhaseDurations;

    constructor(bpm: number = 6.0) {
        this.durations = this.calculateDurations(bpm);
    }

    private calculateDurations(bpm: number): PhaseDurations {
        const cycleMs = (60000 / Math.max(bpm, 1));
        return {
            inhale: cycleMs * 0.4,
            holdIn: cycleMs * 0.1,
            exhale: cycleMs * 0.4,
            holdOut: cycleMs * 0.1
        };
    }

    setBPM(bpm: number) {
        this.durations = this.calculateDurations(bpm);
    }

    tick(dtMs: number): { phase: BreathPhase; progress: number } {
        this.phaseTimer += dtMs;

        let duration = 0;
        switch (this.currentPhase) {
            case BreathPhase.Inhale: duration = this.durations.inhale; break;
            case BreathPhase.HoldIn: duration = this.durations.holdIn; break;
            case BreathPhase.Exhale: duration = this.durations.exhale; break;
            case BreathPhase.HoldOut: duration = this.durations.holdOut; break;
        }

        if (this.phaseTimer >= duration) {
            this.phaseTimer = 0;
            this.nextPhase();
        }

        return {
            phase: this.currentPhase,
            progress: Math.min(this.phaseTimer / duration, 1.0)
        };
    }

    private nextPhase() {
        switch (this.currentPhase) {
            case BreathPhase.Inhale: this.currentPhase = BreathPhase.HoldIn; break;
            case BreathPhase.HoldIn: this.currentPhase = BreathPhase.Exhale; break;
            case BreathPhase.Exhale: this.currentPhase = BreathPhase.HoldOut; break;
            case BreathPhase.HoldOut: this.currentPhase = BreathPhase.Inhale; break;
        }
    }

    getNorm(): number {
        // Return a normalized value (-1 to 1) representing the breath wave
        // Inhale: -1 -> 1, Exhale: 1 -> -1
        const { phase, progress } = this.tick(0); // Peek
        switch (phase) {
            case BreathPhase.Inhale: return -1 + (progress * 2);
            case BreathPhase.HoldIn: return 1;
            case BreathPhase.Exhale: return 1 - (progress * 2);
            case BreathPhase.HoldOut: return -1;
        }
    }
}
