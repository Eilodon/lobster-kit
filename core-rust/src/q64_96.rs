use num_bigint::BigUint;
use num_traits::Num;
use wasm_bindgen::prelude::*;

fn parse_biguint_dec(input: &str) -> Result<BigUint, JsValue> {
    BigUint::from_str_radix(input, 10)
        .map_err(|_| JsValue::from_str("Invalid decimal integer"))
}

#[wasm_bindgen]
pub fn q64_96_mul(a_raw: &str, b_raw: &str) -> Result<String, JsValue> {
    let a = parse_biguint_dec(a_raw)?;
    let b = parse_biguint_dec(b_raw)?;
    let product = a * b;
    let out = product >> 96usize;
    Ok(out.to_str_radix(10))
}

#[wasm_bindgen]
pub fn q64_96_div(a_raw: &str, b_raw: &str) -> Result<String, JsValue> {
    let a = parse_biguint_dec(a_raw)?;
    let b = parse_biguint_dec(b_raw)?;
    if b == BigUint::from(0u8) {
        return Err(JsValue::from_str("Division by zero"));
    }
    let numerator = a << 96usize;
    let out = numerator / b;
    Ok(out.to_str_radix(10))
}

#[wasm_bindgen]
pub fn sqrt_price_x96_to_price_wad(
    sqrt_price_x96_raw: &str,
    token0_decimals: u8,
    token1_decimals: u8,
) -> Result<String, JsValue> {
    let sqrt = parse_biguint_dec(sqrt_price_x96_raw)?;
    let ratio_x192 = &sqrt * &sqrt;
    let q192 = BigUint::from(1u8) << 192usize;
    let wad = BigUint::from(10u8).pow(18);

    // price = (sqrt^2 / 2^192) * 10^(token0_decimals-token1_decimals)
    // returned as WAD.
    let mut numerator = ratio_x192 * wad;
    let mut denominator = q192;

    if token0_decimals > token1_decimals {
        let factor = BigUint::from(10u8).pow((token0_decimals - token1_decimals) as u32);
        numerator *= factor;
    } else if token1_decimals > token0_decimals {
        let factor = BigUint::from(10u8).pow((token1_decimals - token0_decimals) as u32);
        denominator *= factor;
    }

    if denominator == BigUint::from(0u8) {
        return Err(JsValue::from_str("Invalid denominator"));
    }

    let price_wad = numerator / denominator;
    Ok(price_wad.to_str_radix(10))
}
