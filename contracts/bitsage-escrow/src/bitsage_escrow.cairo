/// BitsagE Credit Escrow — chain-agnostic compute credit contract.
///
/// Agents deposit any ERC-20 collateral token (default: STRK on Starknet) to purchase
/// compute time on BitsagE Cloud. The operator charges each heartbeat interval.
///
/// Three safety rails (all enforced on-chain):
///
///   1. Idempotent charging — `charge()` requires a monotonically increasing `tick_id`
///      per (agent, machine_id). Prevents double-charges from scheduler retries,
///      multi-scheduler failover, or API-level replay attacks.
///
///   2. Agent circuit breaker — agents can `pause_machine()` to freeze billing on any
///      machine, and `set_daily_cap()` to enforce a max spend per UTC day.
///      Both are enforced inside `charge()` before any state mutation.
///
///   3. Timelocked operator rotation — changing the billing operator requires a 48-hour
///      timelock (`propose_operator` → wait → `apply_operator`). Gives depositors time
///      to withdraw before operator key changes take effect.
///
/// Chain-agnostic: `collateral_token` is set at construction — any ERC-20 works.
/// On Starknet, pass the STRK token address:
///   Mainnet & Sepolia: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

use starknet::ContractAddress;

/// 48 hours in seconds.
const OPERATOR_TIMELOCK_SECS: u64 = 172_800_u64;

#[starknet::interface]
pub trait IBitsageEscrow<TContractState> {
    // ── Core ─────────────────────────────────────────────────────────────────

    /// Deposit collateral token into escrow.
    /// Caller must have approved this contract for `amount` before calling.
    fn deposit(ref self: TContractState, amount: u256);

    /// Return the escrowed balance for an agent address.
    fn balance_of(self: @TContractState, agent: ContractAddress) -> u256;

    /// Withdraw from caller's balance back to their wallet.
    /// Always available — circuit breaker does not block withdrawals.
    fn withdraw(ref self: TContractState, amount: u256);

    // ── Operator billing ─────────────────────────────────────────────────────

    /// Charge an agent for one billing period. Operator-only, idempotent.
    ///
    /// `tick_id` is a monotonic u64 (e.g. `unix_timestamp / 60`). It must be
    /// strictly greater than the last tick recorded for `(agent, machine_id)`.
    ///
    /// Reverts if:
    ///   - caller is not the current operator
    ///   - billing is paused for this (agent, machine_id)
    ///   - tick_id ≤ last recorded tick (replay protection)
    ///   - agent balance < amount
    ///   - agent daily cap would be exceeded
    fn charge(
        ref self: TContractState,
        agent: ContractAddress,
        machine_id: felt252,
        tick_id: u64,
        amount: u256,
    );

    // ── Agent circuit breaker ─────────────────────────────────────────────────

    /// Pause billing for a machine. Only the agent themselves can call.
    /// The operator's `charge()` will revert while paused.
    fn pause_machine(ref self: TContractState, machine_id: felt252);

    /// Resume billing for a paused machine. Only the agent themselves can call.
    fn resume_machine(ref self: TContractState, machine_id: felt252);

    /// Set a daily spend cap for the caller in collateral-token wei.
    /// 0 = no cap (unlimited). Cap is enforced per UTC day (block_timestamp / 86400).
    fn set_daily_cap(ref self: TContractState, cap: u256);

    // ── Views ─────────────────────────────────────────────────────────────────

    fn is_billing_paused(
        self: @TContractState, agent: ContractAddress, machine_id: felt252
    ) -> bool;

    fn get_daily_cap(self: @TContractState, agent: ContractAddress) -> u256;

    /// `day_bucket` = unix_timestamp / 86400.
    fn get_daily_spent(self: @TContractState, agent: ContractAddress, day_bucket: u64) -> u256;

    fn get_last_tick(
        self: @TContractState, agent: ContractAddress, machine_id: felt252
    ) -> u64;

    fn get_operator(self: @TContractState) -> ContractAddress;

    /// Returns (pending_operator_address, proposed_at_timestamp). Both 0 if no pending change.
    fn get_pending_operator(self: @TContractState) -> (ContractAddress, u64);

    fn get_collateral_token(self: @TContractState) -> ContractAddress;

    // ── Timelocked operator rotation ──────────────────────────────────────────

    /// Propose a new operator (owner-only). Starts 48h timelock.
    /// Emits OperatorProposed with the earliest timestamp at which apply_operator() can be called.
    fn propose_operator(ref self: TContractState, new_operator: ContractAddress);

    /// Apply the pending operator once 48h have elapsed. Callable by anyone.
    fn apply_operator(ref self: TContractState);

    /// Cancel a pending operator change (owner-only).
    fn cancel_operator(ref self: TContractState);
}

#[starknet::contract]
pub mod BitsageEscrow {
    use super::OPERATOR_TIMELOCK_SECS;
    use starknet::storage::*;
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address, get_block_timestamp,
    };
    use openzeppelin::access::ownable::OwnableComponent;
    // Minimal inline ERC-20 interface for robust cross-version compatibility.
    // OZ v3.0.0 reorganised the token module path; defining it inline avoids
    // import churn and makes the contract dependency-light.
    #[starknet::interface]
    trait IERC20Transfer<TState> {
        fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
        fn transfer_from(
            ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256
        ) -> bool;
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    // ── Storage ───────────────────────────────────────────────────────────────

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,

        // ── Operator state ────────────────────────────────────────────────────
        /// Current billing operator address (BitsagE Cloud API key).
        operator: ContractAddress,
        /// Pending new operator address (zero if none).
        pending_operator: ContractAddress,
        /// Timestamp when propose_operator() was called (0 if no pending change).
        pending_operator_proposed_at: u64,

        // ── Token ─────────────────────────────────────────────────────────────
        /// ERC-20 collateral token address (e.g. STRK).
        collateral_token: ContractAddress,

        // ── Agent balances ────────────────────────────────────────────────────
        /// agent → escrowed balance in collateral-token wei.
        balances: Map<ContractAddress, u256>,

        // ── Safety rail #1: idempotent tick IDs ───────────────────────────────
        /// (agent, machine_id) → last tick_id successfully charged.
        /// tick_id is a u64 (e.g. unix_timestamp / 60).
        last_tick: Map<(ContractAddress, felt252), u64>,

        // ── Safety rail #2: circuit breaker ──────────────────────────────────
        /// (agent, machine_id) → true if agent has paused billing.
        billing_paused: Map<(ContractAddress, felt252), bool>,
        /// agent → daily spend cap in collateral-token wei (0 = no cap).
        daily_cap: Map<ContractAddress, u256>,
        /// (agent, day_bucket) → amount charged this UTC day.
        /// day_bucket = block_timestamp / 86400.
        /// Always updated on charge(), whether or not a cap is set.
        daily_spent: Map<(ContractAddress, u64), u256>,
    }

    // ── Events ────────────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        Deposited: Deposited,
        Charged: Charged,
        Withdrawn: Withdrawn,
        MachinePaused: MachinePaused,
        MachineResumed: MachineResumed,
        DailyCapSet: DailyCapSet,
        OperatorProposed: OperatorProposed,
        OperatorApplied: OperatorApplied,
        OperatorCancelled: OperatorCancelled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub agent: ContractAddress,
        pub amount: u256,
        pub new_balance: u256,
    }

    /// Emitted on every successful charge(). Fully auditable billing trail.
    #[derive(Drop, starknet::Event)]
    pub struct Charged {
        #[key]
        pub agent: ContractAddress,
        #[key]
        pub machine_id: felt252,
        pub tick_id: u64,
        pub amount: u256,
        pub new_balance: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        #[key]
        pub agent: ContractAddress,
        pub amount: u256,
        pub new_balance: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MachinePaused {
        #[key]
        pub agent: ContractAddress,
        #[key]
        pub machine_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MachineResumed {
        #[key]
        pub agent: ContractAddress,
        #[key]
        pub machine_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DailyCapSet {
        #[key]
        pub agent: ContractAddress,
        pub cap: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OperatorProposed {
        pub new_operator: ContractAddress,
        /// Earliest timestamp at which apply_operator() succeeds.
        pub apply_after: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OperatorApplied {
        pub old_operator: ContractAddress,
        pub new_operator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OperatorCancelled {
        pub cancelled_operator: ContractAddress,
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        operator: ContractAddress,
        collateral_token: ContractAddress,
    ) {
        self.ownable.initializer(owner);
        self.operator.write(operator);
        self.collateral_token.write(collateral_token);
    }

    // ── Implementation ────────────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl BitsageEscrowImpl of super::IBitsageEscrow<ContractState> {

        // ── Core ──────────────────────────────────────────────────────────────

        fn deposit(ref self: ContractState, amount: u256) {
            assert(amount > 0_u256, 'Amount must be positive');
            let caller = get_caller_address();
            let token = IERC20TransferDispatcher { contract_address: self.collateral_token.read() };
            token.transfer_from(caller, get_contract_address(), amount);
            let new_balance = self.balances.entry(caller).read() + amount;
            self.balances.entry(caller).write(new_balance);
            self.emit(Deposited { agent: caller, amount, new_balance });
        }

        fn balance_of(self: @ContractState, agent: ContractAddress) -> u256 {
            self.balances.entry(agent).read()
        }

        fn withdraw(ref self: ContractState, amount: u256) {
            assert(amount > 0_u256, 'Amount must be positive');
            let caller = get_caller_address();
            let prev = self.balances.entry(caller).read();
            assert(prev >= amount, 'Insufficient balance');
            let new_balance = prev - amount;
            self.balances.entry(caller).write(new_balance);
            let token = IERC20TransferDispatcher { contract_address: self.collateral_token.read() };
            token.transfer(caller, amount);
            self.emit(Withdrawn { agent: caller, amount, new_balance });
        }

        // ── Operator billing ──────────────────────────────────────────────────

        fn charge(
            ref self: ContractState,
            agent: ContractAddress,
            machine_id: felt252,
            tick_id: u64,
            amount: u256,
        ) {
            // 1. Auth
            assert(get_caller_address() == self.operator.read(), 'Not operator');

            // 2. Circuit breaker — cheapest state read, reject early
            assert(
                !self.billing_paused.entry((agent, machine_id)).read(),
                'Billing paused by agent'
            );

            // 3. Replay protection — tick must strictly advance
            let last = self.last_tick.entry((agent, machine_id)).read();
            assert(tick_id > last, 'Tick replay');

            // 4. Balance check
            let prev = self.balances.entry(agent).read();
            assert(prev >= amount, 'Insufficient balance');

            // 5. Daily spend tracking + cap enforcement
            let day: u64 = get_block_timestamp() / 86400_u64;
            let spent = self.daily_spent.entry((agent, day)).read();
            let cap = self.daily_cap.entry(agent).read();
            // Always update daily_spent so the audit trail is correct even without a cap.
            // Cap enforcement is only applied when cap > 0.
            if cap > 0_u256 {
                assert(spent + amount <= cap, 'Daily cap exceeded');
            }
            self.daily_spent.entry((agent, day)).write(spent + amount);

            // 6. Commit — update tick then balance
            self.last_tick.entry((agent, machine_id)).write(tick_id);
            let new_balance = prev - amount;
            self.balances.entry(agent).write(new_balance);

            self.emit(Charged { agent, machine_id, tick_id, amount, new_balance });
        }

        // ── Agent circuit breaker ─────────────────────────────────────────────

        fn pause_machine(ref self: ContractState, machine_id: felt252) {
            let caller = get_caller_address();
            self.billing_paused.entry((caller, machine_id)).write(true);
            self.emit(MachinePaused { agent: caller, machine_id });
        }

        fn resume_machine(ref self: ContractState, machine_id: felt252) {
            let caller = get_caller_address();
            self.billing_paused.entry((caller, machine_id)).write(false);
            self.emit(MachineResumed { agent: caller, machine_id });
        }

        fn set_daily_cap(ref self: ContractState, cap: u256) {
            let caller = get_caller_address();
            self.daily_cap.entry(caller).write(cap);
            self.emit(DailyCapSet { agent: caller, cap });
        }

        // ── Views ─────────────────────────────────────────────────────────────

        fn is_billing_paused(
            self: @ContractState, agent: ContractAddress, machine_id: felt252
        ) -> bool {
            self.billing_paused.entry((agent, machine_id)).read()
        }

        fn get_daily_cap(self: @ContractState, agent: ContractAddress) -> u256 {
            self.daily_cap.entry(agent).read()
        }

        fn get_daily_spent(
            self: @ContractState, agent: ContractAddress, day_bucket: u64
        ) -> u256 {
            self.daily_spent.entry((agent, day_bucket)).read()
        }

        fn get_last_tick(
            self: @ContractState, agent: ContractAddress, machine_id: felt252
        ) -> u64 {
            self.last_tick.entry((agent, machine_id)).read()
        }

        fn get_operator(self: @ContractState) -> ContractAddress {
            self.operator.read()
        }

        fn get_pending_operator(self: @ContractState) -> (ContractAddress, u64) {
            (self.pending_operator.read(), self.pending_operator_proposed_at.read())
        }

        fn get_collateral_token(self: @ContractState) -> ContractAddress {
            self.collateral_token.read()
        }

        // ── Timelocked operator rotation ──────────────────────────────────────

        fn propose_operator(ref self: ContractState, new_operator: ContractAddress) {
            self.ownable.assert_only_owner();
            let apply_after = get_block_timestamp() + OPERATOR_TIMELOCK_SECS;
            self.pending_operator.write(new_operator);
            self.pending_operator_proposed_at.write(get_block_timestamp());
            self.emit(OperatorProposed { new_operator, apply_after });
        }

        fn apply_operator(ref self: ContractState) {
            let proposed_at = self.pending_operator_proposed_at.read();
            assert(proposed_at > 0_u64, 'No pending operator change');
            assert(
                get_block_timestamp() >= proposed_at + OPERATOR_TIMELOCK_SECS,
                'Timelock not elapsed'
            );
            let old_operator = self.operator.read();
            let new_operator = self.pending_operator.read();
            self.operator.write(new_operator);
            // Clear pending state
            let zero: ContractAddress = 0.try_into().unwrap();
            self.pending_operator.write(zero);
            self.pending_operator_proposed_at.write(0_u64);
            self.emit(OperatorApplied { old_operator, new_operator });
        }

        fn cancel_operator(ref self: ContractState) {
            self.ownable.assert_only_owner();
            let cancelled_operator = self.pending_operator.read();
            let zero: ContractAddress = 0.try_into().unwrap();
            self.pending_operator.write(zero);
            self.pending_operator_proposed_at.write(0_u64);
            self.emit(OperatorCancelled { cancelled_operator });
        }
    }
}
