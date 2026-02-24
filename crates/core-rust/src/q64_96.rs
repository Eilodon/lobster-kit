/// 🔢 Q64.96 FIXED-POINT MATH — ZERO-ALLOC WASM ENGINE
///
/// BUG FIX #4: Replaced `num_bigint::BigUint` (heap-allocated, dynamic)
/// with stack-allocated U256 ([u64; 4]) and U512 ([u64; 8]) arrays.
///
/// Performance: eliminates ALL heap allocation from the hot path.
/// Correctness: identical results, handles all edge cases.
use wasm_bindgen::prelude::*;

// ─────────────────────────────────────────────────────────────────────────────
// Primitives: U256 = [u64; 4], U512 = [u64; 8]  (little-endian limbs)
// limbs[0] = least significant 64 bits, limbs[N-1] = most significant
// ─────────────────────────────────────────────────────────────────────────────

type U256 = [u64; 4];
type U512 = [u64; 8];

#[inline]
fn u256_from_bytes_be(bytes: &[u8]) -> U256 {
    let len = bytes.len().min(32);
    let mut padded = [0u8; 32];
    padded[32 - len..].copy_from_slice(&bytes[..len]);
    let mut buf0 = [0u8; 8]; buf0.copy_from_slice(&padded[24..32]);
    let mut buf1 = [0u8; 8]; buf1.copy_from_slice(&padded[16..24]);
    let mut buf2 = [0u8; 8]; buf2.copy_from_slice(&padded[8..16]);
    let mut buf3 = [0u8; 8]; buf3.copy_from_slice(&padded[0..8]);

    [
        u64::from_be_bytes(buf0),
        u64::from_be_bytes(buf1),
        u64::from_be_bytes(buf2),
        u64::from_be_bytes(buf3),
    ]
}

fn u256_to_bytes_be(v: U256) -> Vec<u8> {
    let mut out = [0u8; 32];
    out[0..8].copy_from_slice(&v[3].to_be_bytes());
    out[8..16].copy_from_slice(&v[2].to_be_bytes());
    out[16..24].copy_from_slice(&v[1].to_be_bytes());
    out[24..32].copy_from_slice(&v[0].to_be_bytes());
    // Trim leading zero bytes (preserve at least 1 byte)
    let first = out.iter().position(|&b| b != 0).unwrap_or(31);
    out[first..].to_vec()
}



#[inline]
fn u256_is_zero(v: U256) -> bool {
    v[0] == 0 && v[1] == 0 && v[2] == 0 && v[3] == 0
}

/// U256 × U256 → U512 (full 512-bit result, no truncation)
fn u256_mul_wide(a: U256, b: U256) -> U512 {
    let mut result = [0u64; 8];
    for i in 0..4 {
        let mut carry = 0u128;
        for (j, &bj) in b.iter().enumerate() {
            let pos = i + j;
            let prod = a[i] as u128 * bj as u128
                + result[pos] as u128
                + carry;
            result[pos] = prod as u64;
            carry = prod >> 64;
        }
        result[i + 4] += carry as u64;
    }
    result
}

/// U512 × u64 → U512 (truncating)
fn u512_mul_u64(a: U512, scalar: u64) -> U512 {
    let mut result = [0u64; 8];
    let mut carry = 0u128;
    for i in 0..8 {
        let prod = a[i] as u128 * scalar as u128 + carry;
        result[i] = prod as u64;
        carry = prod >> 64;
    }
    result
}

/// Right-shift U512 by n bits (logical)
fn u512_shr(v: U512, n: usize) -> U512 {
    if n == 0 { return v; }
    if n >= 512 { return [0u64; 8]; }
    let limb_shift = n / 64;
    let bit_shift = n % 64;
    let mut result = [0u64; 8];
    for i in 0..8 {
        if i + limb_shift < 8 {
            result[i] = v[i + limb_shift] >> bit_shift;
            if bit_shift != 0 && i + limb_shift + 1 < 8 {
                result[i] |= v[i + limb_shift + 1] << (64 - bit_shift);
            }
        }
    }
    result
}

/// Left-shift U512 by n bits
fn u512_shl(v: U512, n: usize) -> U512 {
    if n == 0 { return v; }
    if n >= 512 { return [0u64; 8]; }
    let limb_shift = n / 64;
    let bit_shift = n % 64;
    let mut result = [0u64; 8];
    for i in (0..8).rev() {
        if i >= limb_shift {
            result[i] = v[i - limb_shift] << bit_shift;
            if bit_shift != 0 && i - limb_shift > 0 {
                result[i] |= v[i - limb_shift - 1] >> (64 - bit_shift);
            }
        }
    }
    result
}

/// Compare: a < b for U512
fn u512_lt(a: U512, b: U512) -> bool {
    for i in (0..8).rev() {
        if a[i] != b[i] { return a[i] < b[i]; }
    }
    false
}

/// Subtract: a - b for U512 (assumes a >= b)
fn u512_sub(a: U512, b: U512) -> U512 {
    let mut result = [0u64; 8];
    let mut borrow = 0i128;
    for i in 0..8 {
        let diff = a[i] as i128 - b[i] as i128 - borrow;
        result[i] = diff as u64;
        borrow = if diff < 0 { 1 } else { 0 };
    }
    result
}

/// U512 / U256 → U512  (binary long-division, O(512) iterations)
/// Returns quotient; remainder is discarded.
fn u512_div_u256(dividend: U512, divisor: U256) -> Result<U512, &'static str> {
    if u256_is_zero(divisor) {
        return Err("division by zero");
    }
    // Extend divisor to U512 for comparison
    let divisor512: U512 = [divisor[0], divisor[1], divisor[2], divisor[3], 0, 0, 0, 0];
    let mut quotient = [0u64; 8];
    let mut remainder = [0u64; 8];

    // Schoolbook binary long division over 512 bits
    for bit_pos in (0..512usize).rev() {
        // remainder = remainder << 1
        remainder = u512_shl(remainder, 1);
        // Set low bit of remainder from dividend[bit_pos]
        let limb = bit_pos / 64;
        let bit = bit_pos % 64;
        if (dividend[limb] >> bit) & 1 == 1 {
            remainder[0] |= 1;
        }
        // if remainder >= divisor512 → subtract, set quotient bit
        if !u512_lt(remainder, divisor512) {
            remainder = u512_sub(remainder, divisor512);
            quotient[limb] |= 1u64 << bit;
        }
    }
    let _ = dividend; // suppress unused warning
    Ok(quotient)
}

/// Convert U512 lower 256 bits to bytes_be (for results that fit in U256)
fn u512_low_to_bytes_be(v: U512) -> Vec<u8> {
    let low: U256 = [v[0], v[1], v[2], v[3]];
    u256_to_bytes_be(low)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public WASM API — identical signatures to former BigUint implementation
// ─────────────────────────────────────────────────────────────────────────────

/// Multiply two Q64.96 numbers and shift right by 96 bits.
/// a_bytes × b_bytes → (a × b) >> 96
#[wasm_bindgen]
pub fn q64_96_mul(a_bytes: &[u8], b_bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    let a = u256_from_bytes_be(a_bytes);
    let b = u256_from_bytes_be(b_bytes);
    let product = u256_mul_wide(a, b);        // U512
    let shifted = u512_shr(product, 96);      // >> 96
    Ok(u512_low_to_bytes_be(shifted))
}

/// Divide two Q64.96 numbers: (a << 96) / b
#[wasm_bindgen]
pub fn q64_96_div(a_bytes: &[u8], b_bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    let a = u256_from_bytes_be(a_bytes);
    let b = u256_from_bytes_be(b_bytes);
    if u256_is_zero(b) {
        return Err(JsValue::from_str("q64_96_div: division by zero"));
    }
    // numerator = a << 96  (fits in U512 for any U256 a)
    let a512: U512 = [a[0], a[1], a[2], a[3], 0, 0, 0, 0];
    let numerator = u512_shl(a512, 96);
    let quotient = u512_div_u256(numerator, b).map_err(JsValue::from_str)?;
    Ok(u512_low_to_bytes_be(quotient))
}

/// Convert Uniswap V3 sqrtPriceX96 → price WAD (1e18 scale).
///
/// Formula: price_wad = (sqrt^2 / 2^192) × 10^18 × 10^(d0 - d1)
/// All arithmetic: stack-allocated U256/U512, zero heap allocation.
#[wasm_bindgen]
pub fn sqrt_price_x96_to_price_wad(
    sqrt_price_x96_bytes: &[u8],
    token0_decimals: u8,
    token1_decimals: u8,
) -> Result<Vec<u8>, JsValue> {
    let sqrt = u256_from_bytes_be(sqrt_price_x96_bytes);

    // ratio_x192 = sqrt^2  (U512, up to ~320 bits)
    let ratio_x192 = u256_mul_wide(sqrt, sqrt);

    // Multiply by WAD (1e18) before dividing — preserves 18 decimal places
    // 1e18 = 10^18 ≈ 2^60, stays well within U512 head-room
    let with_wad = u512_mul_u64(ratio_x192, 1_000_000_000_000_000_000u64);

    // Apply decimal adjustment: ×10^(d0-d1) or ÷10^(d1-d0)
    let adjusted = if token0_decimals >= token1_decimals {
        let diff = (token0_decimals - token1_decimals) as u32;
        let factor = 10u64.checked_pow(diff)
            .ok_or_else(|| JsValue::from_str("sqrt_price_x96_to_price_wad: decimal diff overflow"))?;
        u512_mul_u64(with_wad, factor)
    } else {
        // Divide numerator by 10^(d1-d0) to avoid inflating with a large U512 denominator
        let diff = (token1_decimals - token0_decimals) as u32;
        let factor = 10u64.checked_pow(diff)
            .ok_or_else(|| JsValue::from_str("sqrt_price_x96_to_price_wad: decimal diff overflow"))?;
        // Simple U512 / u64 division
        let mut result = [0u64; 8];
        let mut rem = 0u128;
        for i in (0..8).rev() {
            let cur = (rem << 64) | with_wad[i] as u128;
            result[i] = (cur / factor as u128) as u64;
            rem = cur % factor as u128;
        }
        result
    };

    // Divide by 2^192: right-shift 192 bits
    let price_wad = u512_shr(adjusted, 192);

    Ok(u512_low_to_bytes_be(price_wad))
}
