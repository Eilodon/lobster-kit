#[derive(Debug, Clone)]
pub struct CriticViolation {
    pub rule: &'static str,
    pub severity: f64,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct CriticVerdict {
    pub passed: bool,
    pub score: f64,
    pub violations: Vec<CriticViolation>,
}

#[derive(Debug, Clone)]
pub struct OutputCritic {
    enabled: bool,
    strict_mode: bool,
    min_quality_score: f64,
}

impl OutputCritic {
    pub fn from_env() -> Self {
        let enabled = std::env::var("OUTPUT_CRITIC_ENABLED")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(true);
        let strict_mode = std::env::var("OUTPUT_CRITIC_STRICT_MODE")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        let min_quality_score = std::env::var("OUTPUT_CRITIC_MIN_QUALITY_SCORE")
            .ok()
            .and_then(|v| v.trim().parse::<f64>().ok())
            .unwrap_or(0.3);

        Self {
            enabled,
            strict_mode,
            min_quality_score,
        }
    }

    pub fn new(enabled: bool, strict_mode: bool, min_quality_score: f64) -> Self {
        Self {
            enabled,
            strict_mode,
            min_quality_score,
        }
    }

    pub fn evaluate(&self, output: &str, expect_json: bool, provider: &str) -> CriticVerdict {
        if !self.enabled {
            return CriticVerdict {
                passed: true,
                score: 1.0,
                violations: vec![],
            };
        }

        let mut violations = Vec::new();
        let trimmed = output.trim();
        if trimmed.is_empty() {
            violations.push(CriticViolation {
                rule: "empty_output",
                severity: 1.0,
                detail: "output is empty".to_string(),
            });
        } else if trimmed.len() < 3 {
            violations.push(CriticViolation {
                rule: "too_short",
                severity: 0.7,
                detail: format!("output too short: {} chars", trimmed.len()),
            });
        }

        if expect_json {
            let json_candidate = extract_json_candidate(trimmed);
            if serde_json::from_str::<serde_json::Value>(&json_candidate).is_err() {
                violations.push(CriticViolation {
                    rule: "json_format",
                    severity: 0.8,
                    detail: "expected JSON output but parse failed".to_string(),
                });
            }
        }

        let lowered = trimmed.to_ascii_lowercase();
        if lowered.contains("nan") {
            violations.push(CriticViolation {
                rule: "value_invariant",
                severity: 0.7,
                detail: "contains NaN marker".to_string(),
            });
        }
        if lowered.contains("infinity") || lowered.contains(" inf ") {
            violations.push(CriticViolation {
                rule: "value_invariant",
                severity: 0.7,
                detail: "contains Infinity marker".to_string(),
            });
        }

        let score_penalty: f64 = violations.iter().map(|v| v.severity * 0.35).sum();
        let score = (1.0 - score_penalty).clamp(0.0, 1.0);
        let passed = if self.strict_mode {
            violations.is_empty()
        } else {
            score >= self.min_quality_score
        };

        if !passed {
            eprintln!(
                "[OutputCritic shared] rejected provider={} score={:.2} violations={}",
                provider,
                score,
                violations.len()
            );
        }

        CriticVerdict {
            passed,
            score,
            violations,
        }
    }
}

fn extract_json_candidate(raw: &str) -> String {
    let fence_start = raw.find("```");
    if let Some(start) = fence_start {
        let suffix = &raw[start + 3..];
        let suffix = suffix.strip_prefix("json").unwrap_or(suffix);
        let suffix = suffix.strip_prefix('\n').unwrap_or(suffix);
        if let Some(end) = suffix.find("```") {
            return suffix[..end].trim().to_string();
        }
    }
    raw.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_critic_rejects_empty() {
        let critic = OutputCritic::new(true, true, 0.3);
        let verdict = critic.evaluate("", false, "test");
        assert!(!verdict.passed);
        assert!(!verdict.violations.is_empty());
    }

    #[test]
    fn test_critic_rejects_invalid_json_when_expected() {
        let critic = OutputCritic::new(true, false, 0.9);
        let verdict = critic.evaluate("plain text", true, "test");
        assert!(!verdict.passed);
    }

    #[test]
    fn test_critic_passes_valid_json() {
        let critic = OutputCritic::new(true, false, 0.3);
        let verdict = critic.evaluate("{\"ok\":true}", true, "test");
        assert!(verdict.passed);
    }
}
