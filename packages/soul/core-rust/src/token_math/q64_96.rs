use ethnum::I256;
use std::ops::{Add, Sub, Mul, Div};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

// Include manual serde impl
include!("q64_96_serde.rs");

/// Q64.96 Fixed Point Number
/// 64 bits integer, 96 bits fractional
/// Backed by I256 (256-bit signed integer)
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Q64_96(pub I256);

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

    /// Multiply without overflow checks (fast, wrapped)
    /// (a * b) >> 96
    pub fn mul(self, other: Self) -> Self {
        let product = self.0.checked_mul(other.0).expect("Q64.96 Mul Overflow");
        Self(product >> 96)
    }

    /// Divide
    /// (a << 96) / b
    pub fn div(self, other: Self) -> Self {
        if other.0 == I256::ZERO {
            panic!("Q64.96 Divide by Zero");
        }
        let scaled = self.0 << 96;
        Self(scaled / other.0)
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

impl Mul for Q64_96 {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        self.mul(rhs)
    }
}

impl Div for Q64_96 {
    type Output = Self;
    fn div(self, rhs: Self) -> Self {
        self.div(rhs)
    }
}
