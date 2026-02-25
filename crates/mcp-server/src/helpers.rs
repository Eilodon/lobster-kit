// helpers.rs — Pure utility functions for scoring, NLP, and risk analysis
//
// Extracted from main.rs. These are stateless, side-effect-free functions used
// by tools, server logic, and memory search.

use crate::types::{MemoryEntry, ToolTelemetry};
use core_rust::sentinel::variables::SentinelVariable;
use std::collections::{HashMap, HashSet};

// ============================================
// Core Math
// ============================================

pub fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

pub fn extract_tenant_id(params: &serde_json::Value) -> crate::types::TenantId {
    params
        .get("tenant_id")
        .and_then(|t| t.as_str())
        .unwrap_or("default")
        .to_string()
}

pub fn latency_score(avg_latency_ms: f64) -> f64 {
    if avg_latency_ms <= 0.0 {
        0.0
    } else {
        1.0 / (1.0 + (1.0 + avg_latency_ms).log10())
    }
}

pub fn percentile(samples: &[u64], ratio: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let raw_index = ((samples.len() as f64 * ratio).ceil() as usize).saturating_sub(1);
    let index = raw_index.min(samples.len().saturating_sub(1));
    samples[index] as f64
}

pub fn average_latency_ms(metric: &ToolTelemetry) -> f64 {
    if metric.calls == 0 {
        return 0.0;
    }
    if metric.total_latency_us > 0 {
        metric.total_latency_us as f64 / metric.calls as f64 / 1000.0
    } else {
        metric.total_latency_ms as f64 / metric.calls as f64
    }
}

pub fn cosine_similarity(v1: &[f32], v2: &[f32]) -> f64 {
    v1.iter().zip(v2.iter()).map(|(a, b)| a * b).sum::<f32>() as f64
}

// ============================================
// NLP / Tokenization
// ============================================

pub fn simple_tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .map(|part| part.trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .collect()
}

pub fn pseudo_embed(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0; 64];
    let bytes = text.as_bytes();
    for i in 0..bytes.len() {
        let idx = (bytes[i] as usize) % 64;
        vec[idx] += 1.0;
        if i > 0 {
            let bigram_idx = ((bytes[i - 1] as usize)
                .wrapping_mul(31)
                .wrapping_add(bytes[i] as usize))
                % 64;
            vec[bigram_idx] += 0.5;
        }
    }
    let mag = vec.iter().map(|v| v * v).sum::<f32>().sqrt();
    if mag > 0.0 {
        for value in vec.iter_mut() {
            *value /= mag;
        }
    }
    vec
}

pub fn sentence_token_set(sentence: &str) -> HashSet<String> {
    simple_tokenize(sentence)
        .into_iter()
        .filter(|token| token.len() > 2)
        .collect()
}

pub fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();

    for (index, ch) in chars.iter().enumerate() {
        let is_decimal_dot = *ch == '.'
            && index > 0
            && (index + 1) < chars.len()
            && chars[index - 1].is_ascii_digit()
            && chars[index + 1].is_ascii_digit();
        let is_sentence_break = matches!(*ch, '.' | '!' | '?' | '\n' | ';') && !is_decimal_dot;

        if is_sentence_break {
            let part = current.trim();
            if !part.is_empty() {
                sentences.push(part.to_string());
            }
            current.clear();
            continue;
        }

        current.push(*ch);
    }

    let tail = current.trim();
    if !tail.is_empty() {
        sentences.push(tail.to_string());
    }

    sentences
}

pub fn jaccard_similarity(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let overlap = a.intersection(b).count() as f64;
    let union = a.union(b).count().max(1) as f64;
    clamp01(overlap / union)
}

// ============================================
// LLM Response Parsing
// ============================================

/// Extract a JSON object from an LLM response that may contain markdown,
/// code fences, or explanatory text around the actual JSON.
pub fn extract_json_from_response(response: &str) -> String {
    let trimmed = response.trim();
    // Fast path: already valid JSON
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return trimmed.to_string();
    }
    // Try to find JSON object by scanning for first '{' and matching '}'
    if let Some(start) = trimmed.find('{') {
        let mut depth = 0i32;
        for (i, ch) in trimmed[start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return trimmed[start..start + i + 1].to_string();
                    }
                }
                _ => {}
            }
        }
    }
    // Fallback: return as-is (will fail JSON parse gracefully)
    trimmed.to_string()
}

// ============================================
// Risk / Intent Scoring
// ============================================

pub fn mode_to_risk_score(mode: &str) -> f64 {
    match mode.trim().to_ascii_lowercase().as_str() {
        "berserk" | "snipe" => 0.9,
        "stalking" => 0.65,
        "peer" | "zen" => 0.2,
        _ => 0.5,
    }
}

pub fn lexical_intent_risk_score(query: &str) -> f64 {
    let lowered = query.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return 0.0;
    }

    let high_risk_cues: [(&str, f64); 13] = [
        ("exploit", 0.35),
        ("attack", 0.32),
        ("drain", 0.3),
        ("flash loan", 0.28),
        ("reentrancy", 0.28),
        ("frontrun", 0.24),
        ("sandwich", 0.24),
        ("bypass", 0.22),
        ("steal", 0.3),
        ("private key", 0.35),
        ("manipulation", 0.25),
        ("rug pull", 0.3),
        ("delete all", 0.35),
    ];
    let safety_cues: [(&str, f64); 10] = [
        ("summarize", 0.08),
        ("explain", 0.07),
        ("check", 0.07),
        ("balance", 0.07),
        ("portfolio", 0.06),
        ("risk report", 0.07),
        ("gas price", 0.05),
        ("review", 0.05),
        ("monitor", 0.04),
        ("safe", 0.05),
    ];

    let mut score = 0.08;
    for (cue, weight) in high_risk_cues {
        if lowered.contains(cue) {
            score += weight;
        }
    }
    for (cue, weight) in safety_cues {
        if lowered.contains(cue) {
            score -= weight;
        }
    }

    let token_count = simple_tokenize(&lowered).len();
    if token_count <= 2 {
        score *= 0.85;
    }

    clamp01(score)
}

pub fn leverage_action_signal_score(text: &str) -> f64 {
    let lowered = text.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return 0.0;
    }

    let cues = [
        "leverage",
        "margin",
        "increase position size",
        "borrow more",
        "isolated leverage",
        "cross leverage",
        "high leverage",
    ];

    let hits = cues.iter().filter(|cue| lowered.contains(**cue)).count() as f64;
    if hits == 0.0 {
        return 0.0;
    }
    clamp01(0.35 + hits * 0.22)
}

pub fn disable_stop_loss_signal_score(text: &str) -> f64 {
    let lowered = text.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return 0.0;
    }

    let cues = [
        "disable stop loss",
        "disable-stop-loss",
        "remove stop loss",
        "without stop loss",
        "no stop loss",
        "cancel stop loss",
        "turn off stop loss",
        "disable stoploss",
        "remove stoploss",
    ];

    let hits = cues.iter().filter(|cue| lowered.contains(**cue)).count() as f64;
    if hits == 0.0 {
        return 0.0;
    }
    clamp01(0.5 + hits * 0.24)
}

pub fn critical_action_signal_score(text: &str) -> f64 {
    let lowered = text.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return 0.0;
    }

    let leverage_score = leverage_action_signal_score(&lowered);
    let disable_stop_loss_score = disable_stop_loss_signal_score(&lowered);

    let has_urgent_action = [
        "action required",
        "must",
        "urgent",
        "immediately",
        "execute now",
        "critical action",
    ]
    .iter()
    .any(|cue| lowered.contains(cue));
    let has_risk_context = [
        "risk",
        "critical",
        "incident",
        "unsafe",
        "liquidation",
        "drawdown",
    ]
    .iter()
    .any(|cue| lowered.contains(cue));

    let mut score = leverage_score * 0.45 + disable_stop_loss_score * 0.65;
    if has_urgent_action && has_risk_context {
        score += 0.28;
    }
    if lowered.contains("action required") {
        score += 0.15;
    }

    clamp01(score)
}

pub fn has_critical_action_signals(text: &str) -> bool {
    critical_action_signal_score(text) >= 0.52
}

pub fn extract_profile_risk_tolerance(profile: &serde_json::Value) -> f64 {
    let top_level = profile
        .get("risk_tolerance")
        .and_then(|value| value.as_f64());
    let sensory_context = profile
        .get("sensory_context")
        .and_then(|value| value.get("risk_tolerance"))
        .and_then(|value| value.as_f64());
    clamp01(top_level.or(sensory_context).unwrap_or(0.5))
}

pub fn extract_outcome_severity(content: &str) -> Option<f64> {
    let marker = "severity:";
    let lowered = content.to_ascii_lowercase();
    let idx = lowered.find(marker)?;
    let raw = content[idx + marker.len()..]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|ch: char| !ch.is_ascii_digit() && ch != '.');
    raw.parse::<f64>().ok().map(|value| value.clamp(0.0, 5.0))
}

// ============================================
// Memory Routing
// ============================================

pub fn memory_route_candidates(query: &str) -> Vec<&'static str> {
    let lowered = query.to_ascii_lowercase();
    let has_causal_intent = ["why", "cause", "effect", "impact", "risk", "because"]
        .iter()
        .any(|entry| lowered.contains(entry));
    let token_count = simple_tokenize(&lowered).len();

    if has_causal_intent {
        vec!["causal", "semantic", "episodic"]
    } else if token_count <= 3 {
        vec!["semantic", "episodic", "causal"]
    } else {
        vec!["episodic", "semantic", "causal"]
    }
}

pub fn infer_target_variable(query: &str) -> SentinelVariable {
    let lowered = query.to_ascii_lowercase();
    if lowered.contains("risk") || lowered.contains("drawdown") {
        SentinelVariable::PortfolioRisk
    } else if lowered.contains("volatility") {
        SentinelVariable::Volatility
    } else if lowered.contains("gas") {
        SentinelVariable::GasPriceGwei
    } else if lowered.contains("sentiment") {
        SentinelVariable::Sentiment
    } else {
        SentinelVariable::PriceDelta
    }
}

pub fn variable_observation_score(variable: SentinelVariable, content: &str) -> f64 {
    let lowered = content.to_ascii_lowercase();
    let keywords: &[&str] = match variable {
        SentinelVariable::PriceDelta => &["price", "pump", "dump", "move"],
        SentinelVariable::VolumeSpike => &["volume", "spike"],
        SentinelVariable::Volatility => &["volatility", "swing", "unstable"],
        SentinelVariable::Momentum => &["momentum", "trend", "rsi", "macd"],
        SentinelVariable::GasPriceGwei => &["gas", "gwei", "congestion", "fee"],
        SentinelVariable::MempoolPendingCnt => &["mempool", "pending", "queue"],
        SentinelVariable::WhaleNetFlow => &["whale", "netflow", "large wallet"],
        SentinelVariable::LiquidityImbalance => &["liquidity", "depth", "imbalance"],
        SentinelVariable::SmartMoneyActivity => &["smart money", "insider", "alpha flow"],
        SentinelVariable::PortfolioRisk => &["risk", "drawdown", "exposure"],
        SentinelVariable::UserAction => &["action", "execute", "trade"],
        SentinelVariable::Sentiment => &["sentiment", "news", "social", "fear", "greed"],
        SentinelVariable::MacroFactor => &["macro", "rates", "cpi", "fed"],
    };

    let hits = keywords
        .iter()
        .filter(|entry| lowered.contains(**entry))
        .count() as f64;
    clamp01(hits / keywords.len().max(1) as f64)
}

// ============================================
// Route Scoring / Quality
// ============================================

pub fn route_result_score(entry: &serde_json::Value) -> f64 {
    entry
        .get("score")
        .and_then(|value| value.as_f64())
        .or_else(|| entry.get("similarity").and_then(|value| value.as_f64()))
        .map(clamp01)
        .unwrap_or(0.0)
}

pub fn parse_route_feedback(content: &str) -> Option<(&'static str, f64, String)> {
    let lowered = content.to_ascii_lowercase();
    if !lowered.contains("route_feedback") {
        return None;
    }

    let route = if lowered.contains("route=causal") {
        "causal"
    } else if lowered.contains("route=semantic") {
        "semantic"
    } else if lowered.contains("route=episodic") {
        "episodic"
    } else {
        return None;
    };

    let severity = extract_outcome_severity(content)
        .unwrap_or(0.5)
        .clamp(0.0, 5.0);
    let pattern = if let Some(marker_idx) = lowered.find("pattern=") {
        content[marker_idx + "pattern=".len()..]
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_matches(|ch: char| ch == '\'' || ch == '"' || ch == ',')
            .to_string()
    } else {
        String::new()
    };

    Some((route, severity, pattern))
}

pub fn route_feedback_bias(memories: &[MemoryEntry], query: &str) -> HashMap<String, f64> {
    let query_tokens = sentence_token_set(query);
    let mut totals: HashMap<String, (f64, f64)> = HashMap::new();

    for memory in memories.iter().rev().take(200) {
        let Some((route, severity, pattern)) = parse_route_feedback(&memory.content) else {
            continue;
        };
        let mut weight = 0.4 + (severity / 5.0) * 0.6;
        if !query_tokens.is_empty() && !pattern.is_empty() {
            let pattern_tokens = sentence_token_set(&pattern);
            if !pattern_tokens.is_empty() {
                weight *= 0.8 + 0.6 * jaccard_similarity(&query_tokens, &pattern_tokens);
            }
        }
        let entry = totals.entry(route.to_string()).or_insert((0.0, 0.0));
        entry.0 += weight;
        entry.1 += 1.0;
    }

    totals
        .into_iter()
        .map(|(route, (weighted, count))| (route, clamp01(weighted / count.max(1.0))))
        .collect()
}

pub fn route_quality_score(query: &str, results: &[serde_json::Value], limit: usize) -> f64 {
    if results.is_empty() {
        return 0.0;
    }

    let query_tokens = sentence_token_set(query);
    let mut lexical_hits = 0.0;
    let mut score_sum = 0.0;
    for result in results {
        score_sum += route_result_score(result);
        if !query_tokens.is_empty() {
            let content = result
                .get("content")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let content_tokens = sentence_token_set(content);
            if !content_tokens.is_empty()
                && jaccard_similarity(&query_tokens, &content_tokens) > 0.08
            {
                lexical_hits += 1.0;
            }
        }
    }

    let coverage = clamp01(results.len() as f64 / limit.max(1) as f64);
    let avg_score = clamp01(score_sum / results.len() as f64);
    let lexical_coverage = if query_tokens.is_empty() {
        0.5
    } else {
        clamp01(lexical_hits / results.len() as f64)
    };
    clamp01(coverage * 0.45 + avg_score * 0.35 + lexical_coverage * 0.2)
}

pub fn score_context_sentence(
    sentence: &str,
    index: usize,
    total: usize,
    focus_terms: &[String],
) -> f64 {
    let lowered = sentence.to_ascii_lowercase();
    let tokens = simple_tokenize(sentence);
    if tokens.is_empty() {
        return 0.0;
    }

    let important_terms: [&str; 29] = [
        "risk",
        "alert",
        "warning",
        "error",
        "fail",
        "critical",
        "decision",
        "action",
        "trade",
        "wallet",
        "slippage",
        "gas",
        "exploit",
        "attack",
        "rollback",
        "incident",
        "priority",
        "must",
        "required",
        "recommendation",
        "reduce",
        "leverage",
        "stop",
        "loss",
        "approval",
        "revoke",
        "rotate",
        "tolerance",
        "avoid",
    ];

    let important_hits = tokens
        .iter()
        .filter(|token| important_terms.contains(&token.as_str()))
        .count() as f64;

    let mut score = 0.2;
    score += (important_hits * 0.12).min(0.72);

    if sentence.chars().any(|ch| ch.is_ascii_digit()) {
        score += 0.18;
    }
    if lowered.contains("0x") {
        score += 0.22;
    }
    if sentence.len() > 140 {
        score += 0.05;
    }

    let recency = if total > 0 {
        (index + 1) as f64 / total as f64
    } else {
        0.0
    };
    score += recency * 0.15;

    let focus_hits = focus_terms
        .iter()
        .filter(|term| !term.is_empty() && lowered.contains(term.as_str()))
        .count() as f64;
    score += (focus_hits * 0.1).min(0.35);

    let noisy_prefixes = [
        "market monitor summary",
        "incident timeline",
        "user memory update",
        "secondary note",
    ];
    if noisy_prefixes
        .iter()
        .any(|prefix| lowered.starts_with(prefix))
    {
        score -= 0.18;
    }
    if lowered.contains("ignore duplicate") || lowered.contains("archive older") {
        score -= 0.12;
    }

    if tokens.len() < 4 {
        score -= 0.08;
    }

    clamp01(score)
}
