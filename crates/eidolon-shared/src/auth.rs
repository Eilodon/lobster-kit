use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct AuthContext {
    pub tenant_id: String,
    pub principal: String,
}

#[derive(Clone, Debug, Default)]
pub struct AuthConfig {
    pub api_keys: HashMap<String, String>,
    pub jwt_secret: Option<String>,
    pub allow_anonymous: bool,
}

#[derive(Debug)]
pub enum AuthError {
    MissingAuthorization,
    InvalidAuthorization,
    Unauthorized,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JwtClaims {
    sub: Option<String>,
    tenant_id: Option<String>,
    exp: usize,
}

impl AuthConfig {
    pub fn from_env() -> Self {
        let mut api_keys = HashMap::new();
        if let Ok(raw) = std::env::var("EIDOLON_GATEWAY_KEYS") {
            for item in raw.split(',') {
                let pair = item.trim();
                if pair.is_empty() {
                    continue;
                }
                let mut parts = pair.splitn(2, ':');
                let key = parts.next().unwrap_or("").trim();
                let tenant = parts.next().unwrap_or("").trim();
                if !key.is_empty() && !tenant.is_empty() {
                    api_keys.insert(key.to_string(), tenant.to_string());
                }
            }
        }

        let jwt_secret = std::env::var("EIDOLON_GATEWAY_JWT_SECRET")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        let allow_anonymous = std::env::var("EIDOLON_GATEWAY_ALLOW_ANON")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        Self {
            api_keys,
            jwt_secret,
            allow_anonymous,
        }
    }
}

pub fn authenticate_bearer(
    authorization_header: Option<&str>,
    config: &AuthConfig,
) -> Result<AuthContext, AuthError> {
    let token = match extract_bearer_token(authorization_header) {
        Ok(token) => token,
        Err(_) if config.allow_anonymous => {
            return Ok(AuthContext {
                tenant_id: "default".to_string(),
                principal: "anonymous".to_string(),
            });
        }
        Err(err) => return Err(err),
    };

    if let Some(tenant) = config.api_keys.get(token) {
        return Ok(AuthContext {
            tenant_id: tenant.clone(),
            principal: "api_key".to_string(),
        });
    }

    if let Some(secret) = &config.jwt_secret {
        let validation = Validation::new(Algorithm::HS256);
        let decoded = jsonwebtoken::decode::<JwtClaims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        )
        .map_err(|_| AuthError::Unauthorized)?;
        let claims = decoded.claims;
        let tenant_id = claims
            .tenant_id
            .or(claims.sub)
            .unwrap_or_else(|| "default".to_string());
        return Ok(AuthContext {
            tenant_id,
            principal: "jwt".to_string(),
        });
    }

    Err(AuthError::Unauthorized)
}

fn extract_bearer_token(authorization_header: Option<&str>) -> Result<&str, AuthError> {
    let Some(raw) = authorization_header else {
        return Err(AuthError::MissingAuthorization);
    };

    let mut parts = raw.trim().splitn(2, ' ');
    let scheme = parts.next().unwrap_or_default();
    let token = parts.next().unwrap_or_default().trim();
    if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() {
        return Err(AuthError::InvalidAuthorization);
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authenticate_bearer_api_key() {
        let mut cfg = AuthConfig::default();
        cfg.api_keys
            .insert("test_key".to_string(), "tenant_a".to_string());
        let res = authenticate_bearer(Some("Bearer test_key"), &cfg).expect("api key auth");
        assert_eq!(res.tenant_id, "tenant_a");
        assert_eq!(res.principal, "api_key");
    }

    #[test]
    fn test_authenticate_bearer_missing_rejected() {
        let cfg = AuthConfig::default();
        let err = authenticate_bearer(None, &cfg).expect_err("missing header should fail");
        assert!(matches!(err, AuthError::MissingAuthorization));
    }
}
