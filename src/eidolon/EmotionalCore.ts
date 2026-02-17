import { ThermodynamicEngine, ThermoConfig } from './ai/ThermodynamicEngine';
import { BreathEngine, BreathPhase } from './ai/BreathEngine';
import { Vector } from './ai/LinearAlgebra';
import { AppendOnlyAdapter } from './memory/AppendOnlyAdapter';
import { EidolonBus, EidolonEventType } from './events/EidolonBus';
import BioParams from '../config/BioParameters.json';

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
  private storage: AppendOnlyAdapter;
  private bus: EidolonBus;

  // AI Engines
  private thermoEngine: ThermodynamicEngine;
  private breathEngine: BreathEngine;

  private readonly SNAPSHOT_KEY = 'emotional_core_snapshot.json';
  private readonly LOG_KEY = 'emotional_core.log'; // Keep for audit trail if needed

  constructor(storage?: AppendOnlyAdapter) {
    this.storage = storage || new AppendOnlyAdapter();
    this.bus = EidolonBus.getInstance();

    this.thermoEngine = new ThermodynamicEngine();
    this.breathEngine = new BreathEngine(BioParams.breathing.baseBPM);

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
    const targetBPM = BioParams.breathing.baseBPM + (this.state.arousal * (BioParams.breathing.maxBPM - BioParams.breathing.baseBPM));
    this.breathEngine.setBPM(targetBPM);
    const breath = this.breathEngine.tick(deltaTime * 1000); // ms

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

    // 🧠 BLIND SPOT FIX: Debounced Save (Max 1 write per 10s) to prevent I/O epilepsy
    // 🧠 FIXED: Use Append Log instead of Debounced Save
    this.appendState();

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
    const burnRate = BioParams.metabolism.glucoseBurnRate * (1 + this.state.arousal); // Faster burn at high arousal
    this.state.glucose = Math.max(BioParams.limits.minHormoneLevel, this.state.glucose - burnRate * dt);

    // Dopamine decay (Motivation)
    this.state.dopamine = Math.max(BioParams.limits.minHormoneLevel, this.state.dopamine - BioParams.metabolism.dopamineDecayRate * dt);

    // Cortisol accumulation (Stress) - driven by volatility and low glucose
    const stressFactor = this.state.volatility * BioParams.metabolism.cortisolSpikeFactor + (this.state.glucose < BioParams.thresholds.starvationGlucose ? 5.0 : 0);
    this.state.cortisol = Math.min(BioParams.limits.maxHormoneLevel, this.state.cortisol + stressFactor * dt);

    // Cortisol decay (Rest)
    if (this.state.arousal < 0.3) {
      this.state.cortisol = Math.max(BioParams.limits.minHormoneLevel, this.state.cortisol - BioParams.metabolism.cortisolDecayRate * dt);
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
    this.state.glucose = Math.min(BioParams.limits.maxHormoneLevel, this.state.glucose + amount);
    this.state.dopamine = Math.min(BioParams.limits.maxHormoneLevel, this.state.dopamine + 5);
    this.tick(this.state.volatility);
  }

  getRiskMultiplier(): number {
    // High Focus + High Momentum + Positive Valence = Aggressive
    // High Cortisol + Caution = Defensive
    const baseRisk = 1.0;

    if (this.state.cortisol > BioParams.thresholds.panicCortisol) return 0.1; // Panic mode

    const flowState = this.state.attention * this.state.momentum;
    const mood = this.state.valence; // 0-1

    if (flowState > BioParams.thresholds.flowStateAttention && mood > BioParams.thresholds.flowStateValence) {
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
      // 1. Try loading from SNAPSHOT (Fast & Recent)
      const snapshot = await this.storage.load<{ state: EmotionalState }>(this.SNAPSHOT_KEY);
      if (snapshot && snapshot.state) {
        this.state = { ...this.state, ...snapshot.state };
        console.log('🧠 Emotional State restored from SNAPSHOT (Ethernal Recurrence)');
        return;
      }

      // 2. Fallback to Log (Slow Replay) - Legacy support
      const logs = await this.storage.readLog(this.LOG_KEY);
      if (logs.length > 0) {
        const lastEntry = logs[logs.length - 1];
        if (lastEntry && lastEntry.state) {
          this.state = { ...this.state, ...lastEntry.state };
          console.log('🧠 Emotional State restored from LOG (Legacy)');
        }
      }
    } catch (e) {
      console.warn("Failed to load emotional state", e);
    }
  }

  async appendState() {
    try {
      // ♾️ ETERNAL RECURRENCE: Overwrite Snapshot (O(1) storage)
      // We save the latest state atomically.
      await this.storage.save(this.SNAPSHOT_KEY, { state: this.state, savedAt: Date.now() });

      // We do NOT append to log every tick anymore to prevent memory leak.
      // Logs are reserved for TRAUMA events (handled in stimulate/processOutcome if needed).
    } catch (e) {
      console.warn("Failed to save emotional state snapshot", e);
    }
  }

  /**
   * 🛑 KILL SWITCH: Stop all internal loops and listeners
   */
  public dispose() {
    // No timeout to clear anymore
    // Unsubscribe from bus (Needs method in Bus)
    // this.bus.unsubscribeAll(this); 
  }
}
