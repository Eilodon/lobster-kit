import React, { useEffect, useState, useRef } from 'react';
import { EmotionalState } from '../EmotionalCore';
import { DecisionLog } from '../EidolonTypes';

interface HolographicDisplayProps {
    emotionalState: EmotionalState;
    recentDecisions: DecisionLog[];
}

export const HolographicDisplay: React.FC<HolographicDisplayProps> = ({
    emotionalState,
    recentDecisions
}) => {
    const [glitch, setGlitch] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // High cortisol causes glitches
        if (emotionalState.cortisol > 60) {
            const chance = (emotionalState.cortisol - 60) / 40; // 0 to 1
            const interval = setInterval(() => {
                if (Math.random() < chance) {
                    setGlitch(true);
                    setTimeout(() => setGlitch(false), 100);
                }
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [emotionalState.cortisol]);

    // Color based on Valence (Red <-> Blue)
    // Valence 0 = Red (Negative), 1 = Blue (Positive), 0.5 = White/Purple
    const r = Math.floor((1 - emotionalState.valence) * 255);
    const b = Math.floor(emotionalState.valence * 255);
    const g = Math.floor(emotionalState.attention * 100);
    const color = `rgb(${r},${g},${b})`;

    return (
        <div style={{
            position: 'absolute',
            top: 0, left: 0, width: '100%', height: '100%',
            pointerEvents: 'none',
            fontFamily: '"Courier New", monospace',
            color: color,
            textShadow: `0 0 10px ${color}`,
            transition: 'color 0.5s ease'
        }}>
            {/* HUD HEADER */}
            <div style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)' }}>
                <div style={{ display: 'flex', gap: '2rem' }}>
                    <StatBlock label="GLUCOSE" value={emotionalState.glucose} max={100} color="#ff00ff" />
                    <StatBlock label="DOPAMINE" value={emotionalState.dopamine} max={100} color="#00ffff" />
                    <StatBlock label="CORTISOL" value={emotionalState.cortisol} max={100} color="#ff0000" />
                </div>
                <div>
                    <h1 style={{ margin: 0, fontSize: '2rem', transform: glitch ? 'skew(5deg)' : 'none' }}>EIDOLON-V</h1>
                    <div style={{ fontSize: '0.8rem', textAlign: 'right', opacity: 0.7 }}>
                        AROUSAL: {emotionalState.arousal.toFixed(2)} | VALENCE: {emotionalState.valence.toFixed(2)}
                    </div>
                </div>
            </div>

            {/* ERROR OVERLAY */}
            {glitch && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,0,0,0.1)', zIndex: 999 }} />}

            {/* THOUGHT STREAM */}
            <div style={{ position: 'absolute', bottom: 20, left: 20, width: 400, maxHeight: 300, overflow: 'hidden' }}>
                <div ref={scrollRef} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {recentDecisions.map((log) => (
                        <div key={log.timestamp} style={{ background: 'rgba(0,0,0,0.5)', padding: 10, borderLeft: '2px solid white' }}>
                            <strong>{log.action}</strong> ({log.confidence}%)
                            <div>{log.reasoning}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const StatBlock: React.FC<{ label: string, value: number, max: number, color: string }> = ({ label, value, max, color }) => (
    <div style={{ display: 'flex', flexDirection: 'column', width: 100 }}>
        <span style={{ fontSize: '0.7rem' }}>{label}</span>
        <div style={{ height: 4, background: '#333', width: '100%', marginTop: 4 }}>
            <div style={{ height: '100%', width: `${(value / max) * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
        </div>
        <span style={{ alignSelf: 'flex-end', fontSize: '0.7rem' }}>{value.toFixed(0)}</span>
    </div>
);
