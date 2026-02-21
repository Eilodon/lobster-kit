//! Order Book - High-Performance Order Matching Engine
//!
//! Lock-free order book using BTreeMap for O(log n) operations.

use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

// ============================================
// Order Types
// ============================================

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderSide {
    Buy = 0,
    Sell = 1,
}

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderStatus {
    Open = 0,
    PartialFill = 1,
    Filled = 2,
    Cancelled = 3,
}

/// Order structure for the book
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u32,
    pub price: i64,      // Fixed-point price (8 decimals)
    pub quantity: i64,   // Fixed-point quantity
    pub filled: i64,     // Amount already filled
    pub side: OrderSide,
    pub owner_id: u32,
    pub timestamp: u64,
}

impl Order {
    pub fn remaining(&self) -> i64 {
        self.quantity - self.filled
    }

    pub fn is_filled(&self) -> bool {
        self.filled >= self.quantity
    }
}

// ============================================
// Trade/Fill Result
// ============================================

/// Result of a matched trade
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct Fill {
    pub maker_id: u32,
    pub taker_id: u32,
    pub price: i64,
    pub quantity: i64,
}

// ============================================
// Order Book
// ============================================

/// High-performance order book using BTreeMap
/// Bids: sorted by price descending (highest first)
/// Asks: sorted by price ascending (lowest first)
#[wasm_bindgen]
pub struct OrderBook {
    // Price -> Vec<Order> (time priority within same price)
    bids: BTreeMap<i64, Vec<Order>>,
    asks: BTreeMap<i64, Vec<Order>>,
    next_order_id: u32,
    current_time: u64,
}

#[wasm_bindgen]
impl OrderBook {
    #[wasm_bindgen(constructor)]
    pub fn new() -> OrderBook {
        OrderBook {
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            next_order_id: 0,
            current_time: 0,
        }
    }

    /// Set current timestamp (for order priority)
    pub fn set_time(&mut self, time: u64) {
        self.current_time = time;
    }

    /// Place a limit order
    /// Returns order ID
    pub fn place_order(
        &mut self,
        price: i64,
        quantity: i64,
        side: OrderSide,
        owner_id: u32,
    ) -> u32 {
        let order_id = self.next_order_id;
        self.next_order_id += 1;

        let mut order = Order {
            id: order_id,
            price,
            quantity,
            filled: 0,
            side,
            owner_id,
            timestamp: self.current_time,
        };

        // Match first, then add remainder to book
        let _fills = self.match_order(&mut order);

        // If order still has remaining quantity, add to book
        if !order.is_filled() {
            self.add_to_book(order);
        }

        order_id
    }

    /// Cancel an order
    pub fn cancel_order(&mut self, order_id: u32, side: OrderSide) -> bool {
        let book = match side {
            OrderSide::Buy => &mut self.bids,
            OrderSide::Sell => &mut self.asks,
        };

        for (_price, orders) in book.iter_mut() {
            if let Some(pos) = orders.iter().position(|o| o.id == order_id) {
                orders.remove(pos);
                return true;
            }
        }

        false
    }

    /// Get best bid price
    pub fn best_bid(&self) -> i64 {
        self.bids.keys().next_back().copied().unwrap_or(0)
    }

    /// Get best ask price
    pub fn best_ask(&self) -> i64 {
        self.asks.keys().next().copied().unwrap_or(i64::MAX)
    }

    /// Get spread in fixed-point
    pub fn spread(&self) -> i64 {
        let bid = self.best_bid();
        let ask = self.best_ask();
        if ask == i64::MAX || bid == 0 {
            return 0;
        }
        ask - bid
    }

    /// Get total bid volume at a price level
    pub fn bid_volume_at(&self, price: i64) -> i64 {
        self.bids
            .get(&price)
            .map(|orders| orders.iter().map(|o| o.remaining()).sum())
            .unwrap_or(0)
    }

    /// Get total ask volume at a price level
    pub fn ask_volume_at(&self, price: i64) -> i64 {
        self.asks
            .get(&price)
            .map(|orders| orders.iter().map(|o| o.remaining()).sum())
            .unwrap_or(0)
    }

    /// Get order book bid depth (number of price levels)
    pub fn bid_depth(&self) -> usize {
        self.bids.len()
    }

    /// Get order book ask depth (number of price levels)
    pub fn ask_depth(&self) -> usize {
        self.asks.len()
    }
}

// Private implementation
impl OrderBook {
    fn match_order(&mut self, taker: &mut Order) -> Vec<Fill> {
        let mut fills = Vec::new();

        let opposite_book = match taker.side {
            OrderSide::Buy => &mut self.asks,
            OrderSide::Sell => &mut self.bids,
        };

        // Get prices to match against
        let prices_to_match: Vec<i64> = match taker.side {
            OrderSide::Buy => {
                // Buy: match against asks <= taker price (lowest first)
                opposite_book
                    .keys()
                    .filter(|&&p| p <= taker.price)
                    .copied()
                    .collect()
            }
            OrderSide::Sell => {
                // Sell: match against bids >= taker price (highest first)
                opposite_book
                    .keys()
                    .filter(|&&p| p >= taker.price)
                    .rev()
                    .copied()
                    .collect()
            }
        };

        for price in prices_to_match {
            if taker.is_filled() {
                break;
            }

            if let Some(makers) = opposite_book.get_mut(&price) {
                let mut i = 0;
                while i < makers.len() && !taker.is_filled() {
                    let maker = &mut makers[i];
                    let fill_qty = std::cmp::min(taker.remaining(), maker.remaining());

                    if fill_qty > 0 {
                        fills.push(Fill {
                            maker_id: maker.id,
                            taker_id: taker.id,
                            price: maker.price,
                            quantity: fill_qty,
                        });

                        maker.filled += fill_qty;
                        taker.filled += fill_qty;

                        if maker.is_filled() {
                            makers.remove(i);
                            continue; // Don't increment i
                        }
                    }
                    i += 1;
                }
            }
        }

        // Clean up empty price levels
        opposite_book.retain(|_, orders| !orders.is_empty());

        fills
    }

    fn add_to_book(&mut self, order: Order) {
        let book = match order.side {
            OrderSide::Buy => &mut self.bids,
            OrderSide::Sell => &mut self.asks,
        };

        book.entry(order.price)
            .or_insert_with(Vec::new)
            .push(order);
    }
}

impl Default for OrderBook {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_place_and_match() {
        let mut book = OrderBook::new();

        // Place a sell order at 100
        book.place_order(100_00000000, 10_00000000, OrderSide::Sell, 1);

        // Place a buy order at 100 - should match
        book.place_order(100_00000000, 5_00000000, OrderSide::Buy, 2);

        // Sell side should have 5 remaining
        assert_eq!(book.ask_volume_at(100_00000000), 5_00000000);
        // Incoming buy was fully matched, so it must NOT rest on bid side.
        assert_eq!(book.bid_volume_at(100_00000000), 0);
    }

    #[test]
    fn test_partial_taker_rests_only_remaining_quantity() {
        let mut book = OrderBook::new();

        // Existing ask liquidity: 5 @ 100
        book.place_order(100_00000000, 5_00000000, OrderSide::Sell, 1);
        // Incoming buy wants 10 @ 100. It should fill 5 and rest only 5.
        book.place_order(100_00000000, 10_00000000, OrderSide::Buy, 2);

        assert_eq!(book.ask_volume_at(100_00000000), 0);
        assert_eq!(book.bid_volume_at(100_00000000), 5_00000000);
    }

    #[test]
    fn test_best_bid_ask() {
        let mut book = OrderBook::new();

        book.place_order(99_00000000, 10_00000000, OrderSide::Buy, 1);
        book.place_order(101_00000000, 10_00000000, OrderSide::Sell, 2);

        assert_eq!(book.best_bid(), 99_00000000);
        assert_eq!(book.best_ask(), 101_00000000);
        assert_eq!(book.spread(), 2_00000000);
    }
}
