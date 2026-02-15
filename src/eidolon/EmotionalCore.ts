import { IStorageProvider } from './memory/IStorageProvider';
import { ThermodynamicEngine, ThermoConfig } from './ai/ThermodynamicEngine';
import { BreathEngine, BreathPhase } from './ai/BreathEngine';
import { Vector } from './ai/LinearAlgebra';
import { GreenfieldAdapter } from './memory/GreenfieldAdapter';
import { EidolonBus, EidolonEventType } from './events/EidolonBus';

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
  private bus: EidolonBus;

  // AI Engines
  private thermoEngine: ThermodynamicEngine;
  private breathEngine: BreathEngine;

  private readonly STORAGE_KEY = 'emotional_core_thermo.json';

  constructor(storage?: IStorageProvider) {
    this.storage = storage || new GreenfieldAdapter({
      bucketName: 'eidolon-memory-core',
      useLocalFallback: !process.env.GREENFIELD_ENDPOINT
    });
    this.bus = EidolonBus.getInstance();

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
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Metabolic Tax: Every block costs energy
    this.bus.subscribe(EidolonEventType.BLOCK_MINED, () => {
      const now = Date.now();
      const dt = (now - this.state.lastUpdate) / 1000;
      this.tick(this.state.volatility, dt);
    });

    // Trauma: Instant Cortisol Spike
    this.bus.subscribe(EidolonEventType.TRAUMA, (event: any) => {
      const severity = event.payload.severity || 10;
      this.stimulate(severity, 'DANGER');
    });
  }

  /**
   * Main simulation tick (Now driven by Block Events)
   */
  async tick(marketVolatility: number = 0.1, dt?: number) {
    const now = Date.now();
    const deltaTime = dt || (now - this.state.lastUpdate) / 1000; // seconds
    if (deltaTime <= 0) return this.state;

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

    // FIX CRITICAL: NaN/Divergence Guard
    const clampedVec = this.clampVector(nextStateVec);

    // Update State
    this.state.arousal = clampedVec.get(0);
    this.state.valence = clampedVec.get(1);
    this.state.attention = clampedVec.get(2);
    this.state.rhythm = clampedVec.get(3);
    this.state.momentum = clampedVec.get(4);

    // 4. Biological Decay / Regeneration
    this.processBiologicalFunction(deltaTime); // Use computed deltaTime

    this.state.lastUpdate = now;
    await this.saveState();

    return this.state;
  }

  /**
   * Get current emotional state without processing a tick
   */
  public getCurrentState(): EmotionalState {
    return { ...this.state };
  }

  // FIX CRITICAL: NaN Guard Helper
  private clampVector(vec: Vector): Vector {
    const data = vec.data.map(v => {
      if (isNaN(v) || !isFinite(v)) return 0.5; // Fail safe to neutral
      return Math.max(0, Math.min(1, v));
    });
    return new Vector(data);
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
   * FIXED: Uses Relative ROI (Sharpe-like) instead of absolute value
   */
  stimulate(value: number, type: 'PROFIT' | 'LOSS' | 'DANGER', capitalAtRisk: number = 0) {
    // 1. Calculate Relative Impact (ROI)
    // If capital is 0 (legacy/danger), use raw value but capped
    let impact = value;

    if (capitalAtRisk > 0) {
      // 10% gain ($10 on $100) = 0.1
      // We scale this to dopamine units (0-100). 
      // A 10% gain is HUGE in trading, let's say that's +20 dopamine.
      const roi = value / capitalAtRisk;
      impact = roi * 200; // 0.05 (5%) -> +10 Dopamine
    } else {
      // Legacy fallback: Logarithmic scaling to prevent "Whale Bias"
      // $10 -> 2.3, $100 -> 4.6, $1000 -> 6.9
      if (type !== 'DANGER') {
        impact = Math.log(value + 1) * 2;
      }
    }

    // Cap single-event impact to prevent emotional overdose
    impact = Math.min(30, impact);

    switch (type) {
      case 'PROFIT':
        this.state.dopamine = Math.min(100, this.state.dopamine + impact);
        this.state.cortisol = Math.max(0, this.state.cortisol - (impact * 0.5));
        console.log(`🧠 STIMULUS: ${type} (+$${value.toFixed(2)} on $${capitalAtRisk}) -> +${impact.toFixed(1)} Dopamine`);
        break;
      case 'LOSS':
        // Losses hurt 2x more (Prospect Theory)
        this.state.cortisol = Math.min(100, this.state.cortisol + (impact * 2));
        this.state.dopamine = Math.max(0, this.state.dopamine - impact);
        console.log(`🧠 STIMULUS: ${type} (-$${value.toFixed(2)} on $${capitalAtRisk}) -> +${(impact * 2).toFixed(1)} Cortisol`);
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
