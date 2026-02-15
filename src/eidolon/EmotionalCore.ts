import { IStorageProvider } from './memory/IStorageProvider';
import { ThermodynamicEngine, ThermoConfig } from './ai/ThermodynamicEngine';
import { BreathEngine, BreathPhase } from './ai/BreathEngine';
import { Vector } from './ai/LinearAlgebra';
import { GreenfieldAdapter } from './memory/GreenfieldAdapter';

export interface EmotionalState {
  glucose: number;   // Energy (0-100)
  dopamine: number;  // Reward/Motivation (0-100)
  cortisol: number;  // Stress (0-100)

  // Thermodynamic State
  arousal: number;   // Intensity (0-1)
  valence: number;   // Positivity (0-1)
  attention: number; // Focus (0-1)
  rhythm: number;    // Cyclic stability (0-1)
  momentum: number;  // Action drive (0-1)

  volatility: number; // Market temperature
  lastUpdate: number;
}

export class EmotionalCore {
  private state: EmotionalState;
  private storage: IStorageProvider;

  // AI Engines
  private thermoEngine: ThermodynamicEngine;
  private breathEngine: BreathEngine;

  private readonly STORAGE_KEY = 'emotional_core_thermo.json';

  constructor(storage?: IStorageProvider) {
    this.storage = storage || new GreenfieldAdapter({
      bucketName: 'eidolon-memory-core',
      useLocalFallback: !process.env.GREENFIELD_ENDPOINT
    });

    this.thermoEngine = new ThermodynamicEngine();
    this.breathEngine = new BreathEngine(6.0); // 6 BPM default

    this.state = {
      glucose: 100,
      dopamine: 50,
      cortisol: 0,
      arousal: 0.5,
      valence: 0.5,
      attention: 0.5,
      rhythm: 0.5,
      momentum: 0.0,
      volatility: 0.1,
      lastUpdate: Date.now()
    };

    this.loadState();
  }

  /**
   * Main simulation tick
   */
  async tick(marketVolatility: number = 0.1) {
    const now = Date.now();
    const dt = (now - this.state.lastUpdate) / 1000; // seconds
    if (dt <= 0) return this.state;

    // 1. Update Market Temperature (affects Thermodynamic interaction)
    this.state.volatility = marketVolatility;
    this.thermoEngine.setTemperature(0.5 + marketVolatility * 5.0); // 0.5 - 5.5 range

    // 2. Breath Engine (Rhythm)
    // Adjust BPM based on Arousal: High arousal = fast breath
    const targetBPM = 6.0 + (this.state.arousal * 20.0);
    this.breathEngine.setBPM(targetBPM);
    const breath = this.breathEngine.tick(dt * 1000); // ms

    // 3. Thermodynamic Evolution
    const currentStateVec = new Vector([
      this.state.arousal,
      this.state.valence,
      this.state.attention,
      this.state.rhythm,
      this.state.momentum
    ]);

    // Target state depends on biological drives
    const targetVec = new Vector([
      this.state.cortisol > 50 ? 0.8 : 0.3, // Arousal target
      this.state.dopamine > 50 ? 0.8 : 0.2, // Valence target
      this.state.glucose > 30 ? 0.9 : 0.4,  // Attention target
      0.5,                                  // Rhythm target (balanced)
      this.state.dopamine > 60 ? 0.8 : 0.1  // Momentum target (action)
    ]);

    const nextStateVec = this.thermoEngine.step(currentStateVec, targetVec);

    // Update State
    this.state.arousal = nextStateVec.get(0);
    this.state.valence = nextStateVec.get(1);
    this.state.attention = nextStateVec.get(2);
    this.state.rhythm = nextStateVec.get(3);
    this.state.momentum = nextStateVec.get(4);

    // 4. Biological Decay / Regeneration
    this.processBiologicalFunction(dt);

    this.state.lastUpdate = now;
    await this.saveState();

    return this.state;
  }

  private processBiologicalFunction(dt: number) {
    // Glucose burn (Energy)
    const burnRate = 0.5 * (1 + this.state.arousal); // Faster burn at high arousal
    this.state.glucose = Math.max(0, this.state.glucose - burnRate * dt);

    // Dopamine decay (Motivation)
    this.state.dopamine = Math.max(0, this.state.dopamine - 1.0 * dt);

    // Cortisol accumulation (Stress) - driven by volatility and low glucose
    const stressFactor = this.state.volatility * 10.0 + (this.state.glucose < 20 ? 5.0 : 0);
    this.state.cortisol = Math.min(100, this.state.cortisol + stressFactor * dt);

    // Cortisol decay (Rest)
    if (this.state.arousal < 0.3) {
      this.state.cortisol = Math.max(0, this.state.cortisol - 2.0 * dt);
    }
  }

  /**
   * Stimulate the agent from external value (Example: Trade profit)
   */
  stimulate(value: number, type: 'PROFIT' | 'LOSS' | 'DANGER') {
    switch (type) {
      case 'PROFIT':
        this.state.dopamine = Math.min(100, this.state.dopamine + value * 2);
        this.state.cortisol = Math.max(0, this.state.cortisol - value);
        break;
      case 'LOSS':
        this.state.cortisol = Math.min(100, this.state.cortisol + value * 2);
        this.state.dopamine = Math.max(0, this.state.dopamine - value);
        break;
      case 'DANGER':
        this.state.arousal = Math.min(1.0, this.state.arousal + 0.3);
        this.state.cortisol = Math.min(100, this.state.cortisol + 20);
        break;
    }
    this.tick(this.state.volatility); // Force update
  }

  feed(amount: number = 30) {
    this.state.glucose = Math.min(100, this.state.glucose + amount);
    this.state.dopamine = Math.min(100, this.state.dopamine + 5);
    this.tick(this.state.volatility);
  }

  getRiskMultiplier(): number {
    // High Focus + High Momentum + Positive Valence = Aggressive
    // High Cortisol + Caution = Defensive
    const baseRisk = 1.0;

    if (this.state.cortisol > 80) return 0.1; // Panic mode

    const flowState = this.state.attention * this.state.momentum;
    const mood = this.state.valence; // 0-1

    if (flowState > 0.6 && mood > 0.6) {
      return baseRisk * 1.5; // Flow state aggression
    }

    return baseRisk * 0.8; // Default conservative
  }

  /**
   * Legacy adapter for RiskParameters
   */
  getRiskParameters(baseParams: any): any {
    const multiplier = this.getRiskMultiplier();
    return {
      ...baseParams,
      maxPositionSize: baseParams.maxPositionSize * multiplier,
      minConfidence: this.state.cortisol > 50 ? 80 : baseParams.minConfidence
    };
  }

  // Adapter for logs
  printBiometrics() {
    console.log(`State: A:${this.state.arousal.toFixed(2)} V:${this.state.valence.toFixed(2)} | G:${this.state.glucose.toFixed(1)} D:${this.state.dopamine.toFixed(1)} C:${this.state.cortisol.toFixed(1)}`);
  }

  async loadState() {
    try {
      const data = await this.storage.load<{ state: EmotionalState }>(this.STORAGE_KEY);
      if (data && data.state) {
        this.state = { ...this.state, ...data.state };
      }
    } catch (e) {
      console.warn("Failed to load emotional state", e);
    }
  }

  async saveState() {
    try {
      await this.storage.save(this.STORAGE_KEY, { state: this.state });
    } catch (e) {
      console.warn("Failed to save emotional state", e);
    }
  }
}
