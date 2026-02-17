import { EmotionalState } from '../EmotionalCore';

/**
 * 🎹 SYNESTHESIA (THERMODYNAMIC EDITION)
 * Generative audio system sonifying the agent's new thermodynamic soul.
 */

export class Synesthesia {
    private audioCtx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private oscillators: OscillatorNode[] = [];
    private lastState: EmotionalState | null = null;

    constructor() {
        try {
            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            this.audioCtx = new AudioContextClass();
            this.masterGain = this.audioCtx!.createGain();
            this.masterGain.connect(this.audioCtx!.destination);
            this.masterGain.gain.setValueAtTime(0.1, this.audioCtx!.currentTime);
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }

    public async start() {
        if (this.audioCtx?.state === 'suspended') {
            await this.audioCtx.resume();
        }
        // Fix: Idempotency check to prevent duplicate drones
        if (this.oscillators.length === 0) {
            this.playDrone();
        }
    }

    public updateState(state: EmotionalState) {
        if (!this.lastState) {
            this.lastState = state;
            this.modulateSound(state);
            return;
        }

        // Only modulate if significant change
        const delta = Math.abs(state.arousal - this.lastState.arousal) + Math.abs(state.valence - this.lastState.valence);
        if (delta > 0.1) {
            this.lastState = state;
            this.modulateSound(state);
        }
    }

    private playDrone() {
        if (!this.audioCtx || !this.masterGain) return;
        // Initial drone
        this.createTone(110, 'sine', 0.5);
        this.createTone(164.81, 'triangle', 0.3);
    }

    private modulateSound(state: EmotionalState) {
        if (!this.audioCtx || !this.masterGain) return;
        const now = this.audioCtx.currentTime;

        // Clear old oscillators
        this.oscillators.forEach(osc => {
            try { osc.stop(now + 2); } catch (e) { }
        });
        this.oscillators = [];

        // Mapping Thermodynamics to Sound
        // Arousal (0-1) -> Pitch Height & Dissonance
        // Valence (0-1) -> Harmony (Major vs Minor/Diminished)

        const baseFreq = 110 + (state.arousal * 220); // 110Hz to 330Hz

        let intervals: number[] = [];
        let type: OscillatorType = 'sine';

        if (state.valence > 0.6) {
            // Positive: Major / Consonant
            intervals = [1.25, 1.5]; // Major 3rd, Perfect 5th
            type = 'triangle';
        } else if (state.valence < 0.4) {
            // Negative: Minor / Dissonant
            intervals = [1.2, 1.414]; // Minor 3rd, Tritone
            type = 'sawtooth';
        } else {
            // Neutral
            intervals = [1.5];
            type = 'sine';
        }

        // High arousal adds high frequency overtones/jitter
        if (state.arousal > 0.8) {
            this.createTone(baseFreq * 4.0, 'square', 0.1); // Harsh overtone
        }

        this.createTone(baseFreq, type, 0.8);
        intervals.forEach(int => this.createTone(baseFreq * int, type, 0.5));
    }

    private createTone(freq: number, type: OscillatorType, volume: number) {
        if (!this.audioCtx || !this.masterGain) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);

        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1 * volume, this.audioCtx.currentTime + 2);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        this.oscillators.push(osc);
    }
}
