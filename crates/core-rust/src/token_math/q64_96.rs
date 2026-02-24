use ethnum::I256;
use std::fmt;
use std::ops::{Add, Sub};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

// Include manual serde impl
include!("q64_96_serde.rs");

/// Q64.96 Fixed Point Number
/// 64 bits integer, 96 bits fractional
/// Backed by I256 (256-bit signed integer)
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Q64_96(pub I256);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Q64_96Error {
    MulOverflow,
    DivisionByZero,
}

impl fmt::Display for Q64_96Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Q64_96Error::MulOverflow => f.write_str("Q64.96 multiplication overflow"),
            Q64_96Error::DivisionByZero => f.write_str("Q64.96 division by zero"),
        }
    }
}

impl Q64_96 {
    pub const FRACTIONAL_BITS: u32 = 96;
    
    // Non-const constructor for defaults
    pub fn one() -> Self {
        Self(I256::ONE << 96)
    }

    pub fn zero() -> Self {
        Self(I256::ZERO)
    }
    
    // Scale factor: 2^96 (runtime calculation for safety or use literal string parsing if needed)
    // For I256, shift left is not const Fn
    pub fn scale() -> I256 {
        I256::ONE << 96
    }

    /// Create from integer part
    pub fn from_u64(v: u64) -> Self {
        Self(I256::from(v) << Self::FRACTIONAL_BITS)
    }

    /// Create from float (approximate)
    pub fn from_f64(v: f64) -> Self {
        let raw = v * (2f64.powi(96));
        Self(I256::from(raw as i128)) // Warning: f64 -> i128 -> I256 might lose precision
        // Better: parse string or manual bit mainpulation if strictly required,
        // but for now standard float conversion is okay for non-critical paths.
    }

    /// Convert to float
    pub fn to_f64(self) -> f64 {
        let (int_part, frac_part): (I256, I256) = (self.0 >> 96, self.0 & (Self::scale() - 1));
        let i = int_part.as_i128() as f64;
        let f = frac_part.as_i128() as f64 / 2f64.powi(96);
        i + f
    }

    /// Multiply with overflow checks (wrapped)
    /// (a * b) >> 96
    pub fn checked_mul(self, other: Self) -> Result<Self, Q64_96Error> {
        self.0
            .checked_mul(other.0)
            .map(|product| Self(product >> 96))
            .ok_or(Q64_96Error::MulOverflow)
    }

    /// Divide
    /// (a << 96) / b
    pub fn checked_div(self, other: Self) -> Result<Self, Q64_96Error> {
        if other.0 == I256::ZERO {
            return Err(Q64_96Error::DivisionByZero);
        }
        let scaled = self.0 << 96;
        Ok(Self(scaled / other.0))
    }
}

// Operator overloads
impl Add for Q64_96 {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self(self.0 + rhs.0)
    }
}

impl Sub for Q64_96 {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self(self.0 - rhs.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_div_reports_division_by_zero() {
        let lhs = Q64_96::from_u64(1);
        let rhs = Q64_96::zero();
        assert_eq!(lhs.checked_div(rhs), Err(Q64_96Error::DivisionByZero));
    }

    #[test]
    fn checked_mul_reports_overflow() {
        let lhs = Q64_96(I256::MAX);
        let rhs = Q64_96::from_u64(2);
        assert_eq!(lhs.checked_mul(rhs), Err(Q64_96Error::MulOverflow));
    }
}
