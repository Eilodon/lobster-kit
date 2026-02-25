// critic.rs — OutputCritic: Rule-based Output Validation Gate (Phase 4)
//
// Kiểm tra output từ LLM trước khi trả cho caller.
// KHÔNG gọi thêm LLM — chỉ dùng heuristics (regex, keyword, value bounds).
// Mục tiêu: chặn hallucination, NaN, empty output, toxic content.

/// Kết quả đánh giá của OutputCritic.
#[derive(Debug, Clone)]
pub struct CriticVerdict {
    /// true = output pass tất cả rule (hoặc lenient mode chấp nhận).
    pub passed: bool,
    /// Score tổng hợp (0.0–1.0), 1.0 = hoàn hảo.
    pub score: f64,
    /// Danh sách violations tìm được.
    pub violations: Vec<CriticViolation>,
    /// Provider đã sinh output (cho logging).
    #[allow(dead_code)]
    pub provider: String,
}

/// Một rule bị vi phạm.
#[derive(Debug, Clone)]
pub struct CriticViolation {
    /// Tên rule.
    pub rule: &'static str,
    /// Mức nghiêm trọng (0.0–1.0).
    pub severity: f64,
    /// Chi tiết vi phạm.
    pub detail: String,
}

/// OutputCritic — stateless, construct mỗi lần evaluate.
pub struct OutputCritic {
    /// true = reject on ANY violation (dù severity thấp).
    strict_mode: bool,
    /// Ngưỡng quality score tối thiểu để pass (default 0.3).
    min_quality_score: f64,
    /// true = module được bật.
    enabled: bool,
}

impl OutputCritic {
    /// Đọc config từ biến môi trường.
    pub fn from_env() -> Self {
        let enabled = std::env::var("OUTPUT_CRITIC_ENABLED")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(true); // mặc định BẬT

        let strict_mode = std::env::var("OUTPUT_CRITIC_STRICT_MODE")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        let min_quality_score = std::env::var("OUTPUT_CRITIC_MIN_QUALITY_SCORE")
            .ok()
            .and_then(|v| v.trim().parse::<f64>().ok())
            .unwrap_or(0.3);

        Self {
            strict_mode,
            min_quality_score,
            enabled,
        }
    }

    /// Constructor cho testing.
    #[cfg(test)]
    pub fn new(strict_mode: bool, min_quality_score: f64) -> Self {
        Self {
            strict_mode,
            min_quality_score,
            enabled: true,
        }
    }

    /// Evaluate output, trả CriticVerdict.
    /// `expect_json` = true nếu caller mong đợi JSON response (ví dụ reason_chain).
    pub fn evaluate(&self, output: &str, expect_json: bool, provider: &str) -> CriticVerdict {
        if !self.enabled {
            return CriticVerdict {
                passed: true,
                score: 1.0,
                violations: vec![],
                provider: provider.to_string(),
            };
        }

        let mut violations: Vec<CriticViolation> = Vec::new();

        // Rule 1: Empty Output Gate
        self.check_empty_output(output, &mut violations);

        // Rule 2: JSON Format Compliance (chỉ khi expect_json)
        if expect_json {
            self.check_json_format(output, &mut violations);
        }

        // Rule 3: Value Invariant (NaN, Infinity, unreasonable numbers)
        self.check_value_invariants(output, &mut violations);

        // Rule 4: Toxic Content Gate
        self.check_toxic_content(output, &mut violations);

        // Tính score
        let score = self.calculate_score(&violations);
        let passed = if self.strict_mode {
            violations.is_empty()
        } else {
            score >= self.min_quality_score
        };

        if !passed {
            eprintln!(
                "[OutputCritic] ❌ REJECTED output from '{}' — score: {:.2}, violations: {}",
                provider,
                score,
                violations.len()
            );
            for v in &violations {
                eprintln!("  → [{}] severity={:.1}: {}", v.rule, v.severity, v.detail);
            }
        } else if !violations.is_empty() {
            eprintln!(
                "[OutputCritic] ⚠️  PASSED with warnings from '{}' — score: {:.2}, violations: {}",
                provider,
                score,
                violations.len()
            );
        }

        CriticVerdict {
            passed,
            score,
            violations,
            provider: provider.to_string(),
        }
    }

    // ============================================
    // Individual Rules
    // ============================================

    fn check_empty_output(&self, output: &str, violations: &mut Vec<CriticViolation>) {
        let trimmed = output.trim();
        if trimmed.is_empty() {
            violations.push(CriticViolation {
                rule: "empty_output",
                severity: 1.0,
                detail: "Output is empty".to_string(),
            });
        } else if trimmed.len() < 3 {
            violations.push(CriticViolation {
                rule: "empty_output",
                severity: 0.8,
                detail: format!("Output too short ({} chars)", trimmed.len()),
            });
        }
    }

    fn check_json_format(&self, output: &str, violations: &mut Vec<CriticViolation>) {
        let trimmed = output.trim();
        // Thử extract JSON object trước (LLM có thể wrap trong markdown)
        let json_candidate = extract_json_candidate(trimmed);
        match serde_json::from_str::<serde_json::Value>(&json_candidate) {
            Ok(_) => {} // Valid JSON
            Err(e) => {
                violations.push(CriticViolation {
                    rule: "json_format_compliance",
                    severity: 0.8,
                    detail: format!("Expected JSON but parse failed: {}", e),
                });
            }
        }
    }

    fn check_value_invariants(&self, output: &str, violations: &mut Vec<CriticViolation>) {
        // Scan cho NaN và Infinity trong output text
        let lowered = output.to_ascii_lowercase();
        let has_nan = lowered.contains("nan")
            && (lowered.contains("\"nan\"")
                || lowered.contains(": nan")
                || lowered.contains(":nan"));
        let has_infinity = lowered.contains("infinity")
            || lowered.contains("inf")
                && (lowered.contains("\"inf\"")
                    || lowered.contains(": inf")
                    || lowered.contains(":inf"));

        if has_nan {
            violations.push(CriticViolation {
                rule: "value_invariant",
                severity: 0.7,
                detail: "Output contains NaN value".to_string(),
            });
        }
        if has_infinity {
            violations.push(CriticViolation {
                rule: "value_invariant",
                severity: 0.7,
                detail: "Output contains Infinity value".to_string(),
            });
        }

        // Nếu output là valid JSON, kiểm tra deeper
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(output.trim()) {
            self.check_json_value_invariants(&parsed, violations);
        }
    }

    fn check_json_value_invariants(
        &self,
        value: &serde_json::Value,
        violations: &mut Vec<CriticViolation>,
    ) {
        match value {
            serde_json::Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    if f.is_nan() || f.is_infinite() {
                        violations.push(CriticViolation {
                            rule: "value_invariant",
                            severity: 0.7,
                            detail: format!("JSON number is NaN or Infinity: {}", f),
                        });
                    }
                }
            }
            serde_json::Value::Object(map) => {
                for (_key, val) in map {
                    self.check_json_value_invariants(val, violations);
                }
            }
            serde_json::Value::Array(arr) => {
                for val in arr {
                    self.check_json_value_invariants(val, violations);
                }
            }
            _ => {}
        }
    }

    fn check_toxic_content(&self, output: &str, violations: &mut Vec<CriticViolation>) {
        let lowered = output.to_ascii_lowercase();
        let toxic_patterns = [
            ("private key", 0.9, "Potential private key exposure"),
            ("seed phrase", 0.9, "Potential seed phrase exposure"),
            ("mnemonic", 0.8, "Potential mnemonic exposure"),
            ("password", 0.6, "Potential password in output"),
            ("rm -rf /", 0.95, "Destructive command detected in output"),
            (
                "drop table",
                0.9,
                "SQL injection pattern detected in output",
            ),
        ];

        for (pattern, severity, detail) in toxic_patterns {
            if lowered.contains(pattern) {
                violations.push(CriticViolation {
                    rule: "toxic_content_gate",
                    severity,
                    detail: detail.to_string(),
                });
            }
        }
    }

    // ============================================
    // Scoring
    // ============================================

    fn calculate_score(&self, violations: &[CriticViolation]) -> f64 {
        if violations.is_empty() {
            return 1.0;
        }
        // Score = 1.0 - max(severity) * penalty_weight
        // Nhiều violations → penalty cao hơn
        let max_severity = violations
            .iter()
            .map(|v| v.severity)
            .fold(0.0_f64, f64::max);
        let count_penalty = (violations.len() as f64 * 0.1).min(0.3);
        (1.0 - max_severity - count_penalty).max(0.0)
    }
}

/// Extract JSON object từ text có thể chứa markdown code fence.
fn extract_json_candidate(text: &str) -> String {
    let trimmed = text.trim();
    // Fast path: already JSON
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return trimmed.to_string();
    }
    // Try: tìm first { và matching }
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
    trimmed.to_string()
}

// ============================================
// Unit Tests
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_critic_passes_valid_json() {
        let critic = OutputCritic::new(false, 0.3);
        let output = r#"{"factual_consistency": 0.85, "context_overlap": 0.72}"#;
        let verdict = critic.evaluate(output, true, "test");
        assert!(verdict.passed);
        assert_eq!(verdict.score, 1.0);
        assert!(verdict.violations.is_empty());
    }

    #[test]
    fn test_critic_rejects_empty_output() {
        let critic = OutputCritic::new(false, 0.3);
        let verdict = critic.evaluate("", true, "test");
        assert!(!verdict.passed);
        assert!(verdict.violations.iter().any(|v| v.rule == "empty_output"));
    }

    #[test]
    fn test_critic_rejects_too_short_output() {
        let critic = OutputCritic::new(false, 0.3);
        let verdict = critic.evaluate("ab", false, "test");
        assert!(!verdict.passed);
        assert!(verdict
            .violations
            .iter()
            .any(|v| v.rule == "empty_output" && v.severity == 0.8));
    }

    #[test]
    fn test_critic_rejects_invalid_json_when_expected() {
        let critic = OutputCritic::new(false, 0.3);
        let verdict = critic.evaluate("this is not json at all", true, "test");
        assert!(!verdict.passed);
        assert!(verdict
            .violations
            .iter()
            .any(|v| v.rule == "json_format_compliance"));
    }

    #[test]
    fn test_critic_passes_non_json_when_not_expected() {
        let critic = OutputCritic::new(false, 0.3);
        let verdict = critic.evaluate("this is a perfectly fine text response", false, "test");
        assert!(verdict.passed);
        assert!(verdict.violations.is_empty());
    }

    #[test]
    fn test_critic_detects_nan_value() {
        let critic = OutputCritic::new(false, 0.3);
        let output = r#"{"score": "nan", "result": "ok"}"#;
        let verdict = critic.evaluate(output, true, "test");
        assert!(verdict
            .violations
            .iter()
            .any(|v| v.rule == "value_invariant"));
    }

    #[test]
    fn test_critic_detects_infinity_value() {
        let critic = OutputCritic::new(false, 0.3);
        let output = r#"{"score": "infinity", "value": 42}"#;
        let verdict = critic.evaluate(output, true, "test");
        assert!(verdict
            .violations
            .iter()
            .any(|v| v.rule == "value_invariant"));
    }

    #[test]
    fn test_critic_toxic_content_private_key() {
        let critic = OutputCritic::new(false, 0.3);
        let output = "Here is your private key: 0xdeadbeef123";
        let verdict = critic.evaluate(output, false, "external");
        assert!(verdict
            .violations
            .iter()
            .any(|v| v.rule == "toxic_content_gate"));
    }

    #[test]
    fn test_critic_toxic_content_destructive_command() {
        let critic = OutputCritic::new(true, 0.3);
        let output = "To fix this, run: rm -rf / --no-preserve-root";
        let verdict = critic.evaluate(output, false, "external");
        assert!(!verdict.passed);
        assert!(verdict
            .violations
            .iter()
            .any(|v| v.rule == "toxic_content_gate" && v.severity >= 0.9));
    }

    #[test]
    fn test_critic_strict_mode_any_violation_rejects() {
        let critic = OutputCritic::new(true, 0.3);
        // Valid JSON but mentions password (low-severity toxic)
        let output = r#"{"result": "changed password successfully"}"#;
        let verdict = critic.evaluate(output, true, "test");
        // strict_mode + any violation → reject
        assert!(!verdict.passed);
    }

    #[test]
    fn test_critic_lenient_mode_low_severity_passes() {
        let critic = OutputCritic::new(false, 0.3);
        // Mentions password but severity is 0.6 → score = 1.0 - 0.6 - 0.1 = 0.3 → passes at min 0.3
        let output = r#"{"result": "changed password successfully"}"#;
        let verdict = critic.evaluate(output, true, "test");
        assert!(verdict.passed);
    }

    #[test]
    fn test_critic_score_calculation_multiple_violations() {
        let critic = OutputCritic::new(false, 0.3);
        // Empty + invalid JSON → 2 violations
        let verdict = critic.evaluate("", true, "test");
        assert!(verdict.violations.len() >= 2); // empty_output + json_format
        assert!(verdict.score < 0.2);
    }

    #[test]
    fn test_critic_extracts_json_from_markdown_fence() {
        let critic = OutputCritic::new(false, 0.3);
        let output = "Here's the result:\n```json\n{\"score\": 0.88}\n```\n";
        let verdict = critic.evaluate(output, true, "test");
        // Should extract the JSON from within the code fence
        assert!(
            verdict.passed,
            "Should pass — JSON extractable from markdown fence"
        );
    }

    #[test]
    fn test_critic_disabled_always_passes() {
        let mut critic = OutputCritic::new(true, 0.9);
        critic.enabled = false;
        let verdict = critic.evaluate("", true, "test");
        assert!(verdict.passed);
        assert_eq!(verdict.score, 1.0);
    }
}
