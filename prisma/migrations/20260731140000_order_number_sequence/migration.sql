-- Order numbers.
--
-- A sequence, not application code: two checkouts completing in the same
-- millisecond must not be able to produce the same number, and a sequence is the
-- only thing that guarantees that without a lock. Starts at 100000 so the first
-- order is not visibly the first order.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 100000 INCREMENT BY 1;
