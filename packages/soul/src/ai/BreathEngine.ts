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
        const duration = this.getCurrentDuration();
        const safeMax = Math.max(0, duration - 1);
        this.phaseTimer = Math.min(Math.max(0, this.phaseTimer), safeMax);
    }

    tick(dtMs: number): { phase: BreathPhase; progress: number } {
        if (!Number.isFinite(dtMs) || dtMs <= 0) {
            return this.getCurrentState();
        }
        this.phaseTimer += dtMs;
        let duration = this.getCurrentDuration();
        let guard = 0;
        while (this.phaseTimer >= duration && guard < 16) {
            this.phaseTimer -= duration;
            this.nextPhase();
            duration = this.getCurrentDuration();
            guard += 1;
        }
        if (guard >= 16) {
            this.phaseTimer = Math.min(this.phaseTimer, duration);
        }

        return this.getCurrentState();
    }

    private getCurrentDuration(): number {
        switch (this.currentPhase) {
            case BreathPhase.Inhale: return this.durations.inhale;
            case BreathPhase.HoldIn: return this.durations.holdIn;
            case BreathPhase.Exhale: return this.durations.exhale;
            case BreathPhase.HoldOut: return this.durations.holdOut;
        }
    }

    private getCurrentState(): { phase: BreathPhase; progress: number } {
        const duration = this.getCurrentDuration();
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
        // Uses Sine wave for smooth derivative (C1 continuity)
        // Inhale: -1 -> 1
        // HoldIn: 1
        // Exhale: 1 -> -1
        // HoldOut: -1
        const { phase, progress } = this.getCurrentState();

        // Map 0..1 linear progress to -PI/2 .. PI/2 for smooth sine transitions
        switch (phase) {
            case BreathPhase.Inhale:
                // sin( -PI/2 ... PI/2 ) -> -1 ... 1
                return Math.sin(-Math.PI / 2 + progress * Math.PI);
            case BreathPhase.HoldIn:
                return 1;
            case BreathPhase.Exhale:
                // sin( PI/2 ... 3PI/2 ) -> 1 ... -1
                return Math.sin(Math.PI / 2 + progress * Math.PI);
            case BreathPhase.HoldOut:
                return -1;
        }
    }
}
