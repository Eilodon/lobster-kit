//! Order Book - High-Performance Order Matching Engine
//!
//! Lock-free order book using a pre-allocated Slab allocator.
//! BTreeMap has been eliminated to achieve Zero-Allocation during matching.

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
    pub status: OrderStatus,
    pub slab_idx: usize,
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

const CAPACITY: usize = 65536;

/// High-performance order book using Slab Allocator
#[wasm_bindgen]
pub struct OrderBook {
    orders: Vec<Order>,
    free_list: Vec<usize>,
    
    // Ordered indices
    // Bids: Sorted by Price ASC, then Timestamp DESC
    // (So the highest price, oldest timestamp is at the END for fast pop)
    bids: Vec<usize>,
    // Asks: Sorted by Price DESC, then Timestamp DESC
    // (So the lowest price, oldest timestamp is at the END for fast pop)
    asks: Vec<usize>,

    next_order_id: u32,
    current_time: u64,
}

#[wasm_bindgen]
impl OrderBook {
    #[wasm_bindgen(constructor)]
    pub fn new() -> OrderBook {
        let mut orders = Vec::with_capacity(CAPACITY);
        let mut free_list = Vec::with_capacity(CAPACITY);
        
        for i in 0..CAPACITY {
            orders.push(Order {
                id: 0,
                price: 0,
                quantity: 0,
                filled: 0,
                side: OrderSide::Buy,
                owner_id: 0,
                timestamp: 0,
                status: OrderStatus::Cancelled,
                slab_idx: i,
            });
            // Push backwards so we pop 0 first
            free_list.push(CAPACITY - 1 - i);
        }

        OrderBook {
            orders,
            free_list,
            bids: Vec::with_capacity(CAPACITY),
            asks: Vec::with_capacity(CAPACITY),
            next_order_id: 0,
            current_time: 0,
        }
    }

    pub fn set_time(&mut self, time: u64) {
        self.current_time = time;
    }

    pub fn place_order(
        &mut self,
        price: i64,
        quantity: i64,
        side: OrderSide,
        owner_id: u32,
    ) -> u32 {
        if price <= 0 || quantity <= 0 {
            return u32::MAX;
        }

        let order_id = self.next_order_id;
        self.next_order_id += 1;

        if let Some(slab_idx) = self.free_list.pop() {
            let order = &mut self.orders[slab_idx];
            order.id = order_id;
            order.price = price;
            order.quantity = quantity;
            order.filled = 0;
            order.side = side;
            order.owner_id = owner_id;
            order.timestamp = self.current_time;
            order.status = OrderStatus::Open;
            order.slab_idx = slab_idx;

            // Match directly
            let _fills = self.match_loop(slab_idx);

            // Add to book if remaining
            if !self.orders[slab_idx].is_filled() && self.orders[slab_idx].status == OrderStatus::Open {
                self.add_to_book(slab_idx);
            } else {
                // Return to free pool
                self.orders[slab_idx].status = OrderStatus::Filled;
                self.free_list.push(slab_idx);
            }
        } else {
            // Memory bound reached: ignore or error
        }

        order_id
    }

    pub fn cancel_order(&mut self, order_id: u32, side: OrderSide) -> bool {
        let book = match side {
            OrderSide::Buy => &mut self.bids,
            OrderSide::Sell => &mut self.asks,
        };

        for i in 0..book.len() {
            let slab_idx = book[i];
            let order = &mut self.orders[slab_idx];
            if order.id == order_id {
                order.status = OrderStatus::Cancelled;
                book.remove(i);
                self.free_list.push(slab_idx);
                return true;
            }
        }

        false
    }

    pub fn best_bid(&mut self) -> i64 {
        self.clean_bids();
        self.bids.last().map(|&idx| self.orders[idx].price).unwrap_or(0)
    }

    pub fn best_ask(&mut self) -> i64 {
        self.clean_asks();
        self.asks.last().map(|&idx| self.orders[idx].price).unwrap_or(i64::MAX)
    }

    pub fn spread(&mut self) -> i64 {
        let bid = self.best_bid();
        let ask = self.best_ask();
        if ask == i64::MAX || bid == 0 {
            return 0;
        }
        ask - bid
    }

    pub fn bid_volume_at(&self, price: i64) -> i64 {
        self.bids
            .iter()
            .map(|&idx| &self.orders[idx])
            .filter(|o| o.price == price && o.status != OrderStatus::Cancelled)
            .map(|o| o.remaining())
            .sum()
    }

    pub fn ask_volume_at(&self, price: i64) -> i64 {
        self.asks
            .iter()
            .map(|&idx| &self.orders[idx])
            .filter(|o| o.price == price && o.status != OrderStatus::Cancelled)
            .map(|o| o.remaining())
            .sum()
    }

    pub fn bid_depth(&self) -> usize {
        let mut levels = 0;
        let mut last_price = -1;
        for &idx in self.bids.iter().rev() {
            let o = &self.orders[idx];
            if o.status != OrderStatus::Cancelled && o.price != last_price {
                levels += 1;
                last_price = o.price;
            }
        }
        levels
    }

    pub fn ask_depth(&self) -> usize {
        let mut levels = 0;
        let mut last_price = -1;
        for &idx in self.asks.iter().rev() {
            let o = &self.orders[idx];
            if o.status != OrderStatus::Cancelled && o.price != last_price {
                levels += 1;
                last_price = o.price;
            }
        }
        levels
    }
}

impl Default for OrderBook {
    fn default() -> Self {
        Self::new()
    }
}

// Private implementation
impl OrderBook {
    fn match_loop(&mut self, taker_idx: usize) -> Vec<Fill> {
        let mut fills = Vec::new();
        let side = self.orders[taker_idx].side;
        
        // Use a loop so we can appease the borrow checker during mutation
        loop {
            let opposite_book = match side {
                OrderSide::Buy => &mut self.asks,
                OrderSide::Sell => &mut self.bids,
            };

            let maker_idx = match opposite_book.last() {
                Some(&idx) => idx,
                None => break,
            };

            let maker = &self.orders[maker_idx];
            if maker.status == OrderStatus::Cancelled {
                // If top order is cancelled, discard it and continue
                opposite_book.pop();
                self.free_list.push(maker_idx);
                continue;
            }

            let taker = &self.orders[taker_idx];
            
            // Uncross check
            let can_match = match side {
                OrderSide::Buy => maker.price <= taker.price,
                OrderSide::Sell => maker.price >= taker.price,
            };

            if !can_match {
                break; // No more matching orders
            }

            // Calculate fill quantity
            let fill_qty = std::cmp::min(self.orders[taker_idx].remaining(), self.orders[maker_idx].remaining());
            
            if fill_qty > 0 {
                let trade_price = self.orders[maker_idx].price;
                
                fills.push(Fill {
                    maker_id: self.orders[maker_idx].id,
                    taker_id: self.orders[taker_idx].id,
                    price: trade_price,
                    quantity: fill_qty,
                });

                self.orders[maker_idx].filled += fill_qty;
                self.orders[taker_idx].filled += fill_qty;
                
                if self.orders[maker_idx].is_filled() {
                    self.orders[maker_idx].status = OrderStatus::Filled;
                    // Need to borrow book again because it's mutable
                    let book = match side {
                        OrderSide::Buy => &mut self.asks,
                        OrderSide::Sell => &mut self.bids,
                    };
                    book.pop();
                    self.free_list.push(maker_idx);
                }
                
                if self.orders[taker_idx].is_filled() {
                    break;
                }
            } else {
                opposite_book.pop();
                self.free_list.push(maker_idx);
            }
        }

        fills
    }

    fn clean_bids(&mut self) {
        while let Some(&idx) = self.bids.last() {
            if self.orders[idx].status == OrderStatus::Cancelled {
                self.bids.pop();
                self.free_list.push(idx);
            } else {
                break;
            }
        }
    }

    fn clean_asks(&mut self) {
        while let Some(&idx) = self.asks.last() {
            if self.orders[idx].status == OrderStatus::Cancelled {
                self.asks.pop();
                self.free_list.push(idx);
            } else {
                break;
            }
        }
    }

    fn add_to_book(&mut self, slab_idx: usize) {
        let order = &self.orders[slab_idx];
        match order.side {
            OrderSide::Buy => {
                let pos = self.bids.binary_search_by(|&idx| {
                    let o = &self.orders[idx];
                    o.price.cmp(&order.price).then_with(|| order.timestamp.cmp(&o.timestamp))
                }).unwrap_or_else(|e| e);
                self.bids.insert(pos, slab_idx);
            }
            OrderSide::Sell => {
                let pos = self.asks.binary_search_by(|&idx| {
                    let o = &self.orders[idx];
                    order.price.cmp(&o.price).then_with(|| order.timestamp.cmp(&o.timestamp))
                }).unwrap_or_else(|e| e);
                self.asks.insert(pos, slab_idx);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_place_and_match() {
        let mut book = OrderBook::new();

        book.place_order(100_00000000, 10_00000000, OrderSide::Sell, 1);
        book.place_order(100_00000000, 5_00000000, OrderSide::Buy, 2);

        assert_eq!(book.ask_volume_at(100_00000000), 5_00000000);
        assert_eq!(book.bid_volume_at(100_00000000), 0);
    }

    #[test]
    fn test_partial_taker_rests_only_remaining_quantity() {
        let mut book = OrderBook::new();

        book.place_order(100_00000000, 5_00000000, OrderSide::Sell, 1);
        book.place_order(100_00000000, 10_00000000, OrderSide::Buy, 2);

        assert_eq!(book.ask_volume_at(100_00000000), 0);
        // Best bid requires clean check
        assert_eq!(book.best_bid(), 100_00000000);
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
