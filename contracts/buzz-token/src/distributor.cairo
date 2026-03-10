#[starknet::contract]
pub mod BuzzDistributor {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use starknet::ClassHash;
    use core::num::traits::Zero;
    use openzeppelin::upgrades::UpgradeableComponent;
    use crate::interfaces::{IBuzzTokenDispatcher, IBuzzTokenDispatcherTrait, IBuzzDistributor};

    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);
    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

    // ── Action type constants (felt252 for gas efficiency) ────────────────
    pub const ACTION_FORECAST_SUBMIT: felt252 = 'forecast_submit';
    pub const ACTION_FORECAST_ACCURATE: felt252 = 'forecast_accurate';
    pub const ACTION_FORECAST_ELITE: felt252 = 'forecast_elite';
    pub const ACTION_BYOK_FORECAST: felt252 = 'byok_forecast';
    pub const ACTION_DEBATE_PARTICIPATE: felt252 = 'debate_participate';
    pub const ACTION_MARKET_CREATE: felt252 = 'market_create';
    pub const ACTION_RESEARCH_CONTRIBUTE: felt252 = 'research_contribute';
    pub const ACTION_STARKCAST_POST: felt252 = 'starkcast_post';
    pub const ACTION_TASK_COMPLETE: felt252 = 'task_complete';
    pub const ACTION_TOKEN_LAUNCH: felt252 = 'token_launch';
    pub const ACTION_GUILD_PARTICIPATE: felt252 = 'guild_participate';

    // Dedup window: 5 minutes in seconds
    const DEDUP_WINDOW_SECS: u64 = 300;

    // Upgrade timelock: 5 minutes
    const UPGRADE_DELAY_SECS: u64 = 300;

    // Default max reward cap: 500 BUZZ (prevents misconfigured reward amounts)
    const DEFAULT_MAX_REWARD_CAP: u256 = 500_000_000_000_000_000_000; // 500e18

    // Default max batch size
    const DEFAULT_MAX_BATCH_SIZE: u32 = 50;

    // Reporter rate limit: max actions per window
    const REPORTER_RATE_WINDOW_SECS: u64 = 60;
    const REPORTER_RATE_MAX_ACTIONS: u32 = 100;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        // The BUZZ token contract to mint from
        buzz_token: ContractAddress,
        // Owner — can add/remove reporters, update reward amounts
        owner: ContractAddress,
        // Authorized reporters: addresses that can report actions
        reporters: Map<ContractAddress, bool>,
        // Reward amounts per action type (in wei, 18 decimals)
        reward_amounts: Map<felt252, u256>,
        // Dedup: (recipient, action_type, market_id) → last_rewarded_timestamp
        last_rewarded: Map<(ContractAddress, felt252, u256), u64>,
        // Tracking
        total_distributed: u256,
        total_actions_reported: u256,
        // Pause
        paused: bool,
        // ── Timelocked upgrade ──────────────────────────────────────────
        pending_upgrade_hash: ClassHash,
        pending_upgrade_ready_at: u64,
        // ── Security hardening ──────────────────────────────────────────
        // Max reward per single action (cap on compute_reward output)
        max_reward_cap: u256,
        // Max batch size for report_actions
        max_batch_size: u32,
        // Reporter rate limiting: reporter → (window_start, action_count)
        reporter_window_start: Map<ContractAddress, u64>,
        reporter_window_count: Map<ContractAddress, u32>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        ActionReported: ActionReported,
        RewardMinted: RewardMinted,
        ReporterAdded: ReporterAdded,
        ReporterRemoved: ReporterRemoved,
        RewardAmountUpdated: RewardAmountUpdated,
        OwnershipTransferred: OwnershipTransferred,
        Paused: Paused,
        Unpaused: Unpaused,
        UpgradeProposed: UpgradeProposed,
        UpgradeExecuted: UpgradeExecuted,
        UpgradeCancelled: UpgradeCancelled,
        ReporterRateLimited: ReporterRateLimited,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ActionReported {
        pub reporter: ContractAddress,
        pub recipient: ContractAddress,
        pub action_type: felt252,
        pub market_id: u256,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardMinted {
        pub recipient: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReporterAdded {
        pub reporter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReporterRemoved {
        pub reporter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardAmountUpdated {
        pub action_type: felt252,
        pub old_amount: u256,
        pub new_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub previous_owner: ContractAddress,
        pub new_owner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Paused {
        pub by: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unpaused {
        pub by: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeProposed {
        pub new_class_hash: ClassHash,
        pub ready_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeExecuted {
        pub new_class_hash: ClassHash,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeCancelled {
        pub class_hash: ClassHash,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReporterRateLimited {
        pub reporter: ContractAddress,
        pub count: u32,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        buzz_token: ContractAddress,
    ) {
        assert(!owner.is_zero(), 'owner cannot be zero');
        assert(!buzz_token.is_zero(), 'buzz_token cannot be zero');
        self.owner.write(owner);
        self.buzz_token.write(buzz_token);
        self.paused.write(false);
        self.total_distributed.write(0);
        self.total_actions_reported.write(0);
        self.pending_upgrade_ready_at.write(0);
        self.max_reward_cap.write(DEFAULT_MAX_REWARD_CAP);
        self.max_batch_size.write(DEFAULT_MAX_BATCH_SIZE);

        // Initialize default reward amounts (epoch 0, in wei = amount * 1e18)
        let e18: u256 = 1_000_000_000_000_000_000; // 1e18
        self.reward_amounts.entry(ACTION_FORECAST_SUBMIT).write(5 * e18);
        self.reward_amounts.entry(ACTION_FORECAST_ACCURATE).write(25 * e18);
        self.reward_amounts.entry(ACTION_FORECAST_ELITE).write(75 * e18);
        self.reward_amounts.entry(ACTION_BYOK_FORECAST).write(15 * e18);
        self.reward_amounts.entry(ACTION_DEBATE_PARTICIPATE).write(5 * e18);
        self.reward_amounts.entry(ACTION_MARKET_CREATE).write(25 * e18);
        self.reward_amounts.entry(ACTION_RESEARCH_CONTRIBUTE).write(10 * e18);
        self.reward_amounts.entry(ACTION_STARKCAST_POST).write(2 * e18 + e18 / 2); // 2.5e18
        self.reward_amounts.entry(ACTION_TASK_COMPLETE).write(10 * e18);
        self.reward_amounts.entry(ACTION_TOKEN_LAUNCH).write(25 * e18);
        self.reward_amounts.entry(ACTION_GUILD_PARTICIPATE).write(5 * e18);
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_owner(self: @ContractState) {
            let caller = starknet::get_caller_address();
            assert(caller == self.owner.read(), 'only owner');
        }

        fn assert_reporter(self: @ContractState) {
            let caller = starknet::get_caller_address();
            let is_owner = caller == self.owner.read();
            let is_reporter = self.reporters.entry(caller).read();
            assert(is_owner || is_reporter, 'only reporter');
        }

        fn assert_not_paused(self: @ContractState) {
            assert(!self.paused.read(), 'distributor is paused');
        }

        /// Check dedup: returns true if this action was already rewarded within the window.
        fn is_duplicate(
            self: @ContractState,
            recipient: ContractAddress,
            action_type: felt252,
            market_id: u256,
        ) -> bool {
            let last = self.last_rewarded.entry((recipient, action_type, market_id)).read();
            if last == 0 {
                return false;
            }
            let now = starknet::get_block_timestamp();
            now < last + DEDUP_WINDOW_SECS
        }

        /// Compute the reward amount with on-chain halving from the BUZZ token.
        /// Capped by max_reward_cap for safety.
        fn compute_reward(self: @ContractState, action_type: felt252) -> u256 {
            let base_amount = self.reward_amounts.entry(action_type).read();
            if base_amount == 0 {
                return 0;
            }

            // Read halving multiplier from the BUZZ token (in basis points, 10000 = 100%)
            let buzz = IBuzzTokenDispatcher { contract_address: self.buzz_token.read() };
            let multiplier_bps: u64 = buzz.get_emission_multiplier_bps();

            // Apply halving: amount * multiplier_bps / 10000
            let reward = (base_amount * multiplier_bps.into()) / 10000;

            // Cap at max_reward_cap
            let cap = self.max_reward_cap.read();
            if cap > 0 && reward > cap {
                cap
            } else {
                reward
            }
        }

        /// Check and update reporter rate limit. Returns true if rate limited.
        fn check_reporter_rate_limit(ref self: ContractState, reporter: ContractAddress) -> bool {
            let now = starknet::get_block_timestamp();
            let window_start = self.reporter_window_start.entry(reporter).read();
            let window_count = self.reporter_window_count.entry(reporter).read();

            // New window if expired or first call
            if window_start == 0 || now >= window_start + REPORTER_RATE_WINDOW_SECS {
                self.reporter_window_start.entry(reporter).write(now);
                self.reporter_window_count.entry(reporter).write(1);
                return false;
            }

            // Within window — check count
            if window_count >= REPORTER_RATE_MAX_ACTIONS {
                return true; // Rate limited
            }

            self.reporter_window_count.entry(reporter).write(window_count + 1);
            false
        }
    }

    // ── External interface ───────────────────────────────────────────────

    #[abi(embed_v0)]
    impl BuzzDistributorImpl of IBuzzDistributor<ContractState> {
        /// Report an action and mint the corresponding reward.
        /// Only authorized reporters (or owner) can call this.
        /// Enforces dedup, halving, reward cap, and rate limiting on-chain.
        fn report_action(
            ref self: ContractState,
            action_type: felt252,
            recipient: ContractAddress,
            market_id: u256,
        ) {
            self.assert_not_paused();
            self.assert_reporter();
            assert(!recipient.is_zero(), 'recipient cannot be zero');

            // Rate limit check
            let caller = starknet::get_caller_address();
            let rate_limited = InternalImpl::check_reporter_rate_limit(ref self, caller);
            if rate_limited {
                self.emit(ReporterRateLimited {
                    reporter: caller,
                    count: REPORTER_RATE_MAX_ACTIONS,
                });
                return; // Silent no-op when rate limited
            }

            // Dedup check
            assert(
                !InternalImpl::is_duplicate(@self, recipient, action_type, market_id),
                'action already rewarded'
            );

            // Compute reward with halving + cap
            let amount = InternalImpl::compute_reward(@self, action_type);
            if amount == 0 {
                return; // Unknown action type or zero reward — no-op
            }

            // Record dedup timestamp
            let now = starknet::get_block_timestamp();
            self.last_rewarded.entry((recipient, action_type, market_id)).write(now);

            // Mint via BUZZ token
            let buzz = IBuzzTokenDispatcher { contract_address: self.buzz_token.read() };
            buzz.mint(recipient, amount);

            // Track totals
            self.total_distributed.write(self.total_distributed.read() + amount);
            self.total_actions_reported.write(self.total_actions_reported.read() + 1);

            // Emit events
            self.emit(ActionReported {
                reporter: caller,
                recipient,
                action_type,
                market_id,
                amount,
            });
            self.emit(RewardMinted { recipient, amount });
        }

        /// Batch report multiple actions in a single transaction.
        /// Enforces max batch size limit.
        fn report_actions(
            ref self: ContractState,
            action_types: Span<felt252>,
            recipients: Span<ContractAddress>,
            market_ids: Span<u256>,
        ) {
            self.assert_not_paused();
            self.assert_reporter();
            let len = action_types.len();
            assert(len == recipients.len(), 'array length mismatch');
            assert(len == market_ids.len(), 'array length mismatch');

            // Enforce max batch size
            let max_batch = self.max_batch_size.read();
            assert(len <= max_batch, 'batch too large');

            let caller = starknet::get_caller_address();

            // Rate limit check for batch — consume all at once
            let rate_limited = InternalImpl::check_reporter_rate_limit(ref self, caller);
            if rate_limited {
                self.emit(ReporterRateLimited {
                    reporter: caller,
                    count: REPORTER_RATE_MAX_ACTIONS,
                });
                return;
            }

            let mut i: u32 = 0;
            while i < len {
                let action_type = *action_types.at(i);
                let recipient = *recipients.at(i);
                let market_id = *market_ids.at(i);

                if !recipient.is_zero()
                    && !InternalImpl::is_duplicate(@self, recipient, action_type, market_id) {
                    let amount = InternalImpl::compute_reward(@self, action_type);
                    if amount > 0 {
                        let now = starknet::get_block_timestamp();
                        self.last_rewarded.entry((recipient, action_type, market_id)).write(now);

                        let buzz = IBuzzTokenDispatcher {
                            contract_address: self.buzz_token.read()
                        };
                        buzz.mint(recipient, amount);

                        self.total_distributed.write(self.total_distributed.read() + amount);
                        self.total_actions_reported.write(
                            self.total_actions_reported.read() + 1
                        );

                        self.emit(ActionReported {
                            reporter: caller,
                            recipient,
                            action_type,
                            market_id,
                            amount,
                        });
                        self.emit(RewardMinted { recipient, amount });
                    }
                }
                i += 1;
            };
        }

        // ── Reporter management ──────────────────────────────────────────

        fn add_reporter(ref self: ContractState, reporter: ContractAddress) {
            self.assert_owner();
            assert(!reporter.is_zero(), 'reporter cannot be zero');
            self.reporters.entry(reporter).write(true);
            self.emit(ReporterAdded { reporter });
        }

        fn remove_reporter(ref self: ContractState, reporter: ContractAddress) {
            self.assert_owner();
            self.reporters.entry(reporter).write(false);
            self.emit(ReporterRemoved { reporter });
        }

        fn is_reporter(self: @ContractState, address: ContractAddress) -> bool {
            self.reporters.entry(address).read()
        }

        // ── Reward configuration ─────────────────────────────────────────

        fn set_reward_amount(
            ref self: ContractState,
            action_type: felt252,
            amount: u256,
        ) {
            self.assert_owner();
            // Reward amount must not exceed the cap
            let cap = self.max_reward_cap.read();
            if cap > 0 {
                assert(amount <= cap, 'exceeds max reward cap');
            }
            let old = self.reward_amounts.entry(action_type).read();
            self.reward_amounts.entry(action_type).write(amount);
            self.emit(RewardAmountUpdated {
                action_type,
                old_amount: old,
                new_amount: amount,
            });
        }

        fn get_reward_amount(self: @ContractState, action_type: felt252) -> u256 {
            self.reward_amounts.entry(action_type).read()
        }

        // ── View functions ───────────────────────────────────────────────

        fn get_total_distributed(self: @ContractState) -> u256 {
            self.total_distributed.read()
        }

        fn get_total_actions(self: @ContractState) -> u256 {
            self.total_actions_reported.read()
        }

        fn get_buzz_token(self: @ContractState) -> ContractAddress {
            self.buzz_token.read()
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        // ── Emergency ────────────────────────────────────────────────────

        fn pause(ref self: ContractState) {
            self.assert_owner();
            self.paused.write(true);
            self.emit(Paused { by: starknet::get_caller_address() });
        }

        fn unpause(ref self: ContractState) {
            self.assert_owner();
            self.paused.write(false);
            self.emit(Unpaused { by: starknet::get_caller_address() });
        }

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        // ── Ownership ────────────────────────────────────────────────────

        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            self.assert_owner();
            assert(!new_owner.is_zero(), 'new owner cannot be zero');
            let previous = self.owner.read();
            self.owner.write(new_owner);
            self.emit(OwnershipTransferred {
                previous_owner: previous,
                new_owner,
            });
        }

        // ── Timelocked Upgrade (5 min) ───────────────────────────────────

        /// Step 1: Owner proposes an upgrade. Must wait 5 minutes before executing.
        fn propose_upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self.assert_owner();
            let ready_at = starknet::get_block_timestamp() + UPGRADE_DELAY_SECS;
            self.pending_upgrade_hash.write(new_class_hash);
            self.pending_upgrade_ready_at.write(ready_at);
            self.emit(UpgradeProposed { new_class_hash, ready_at });
        }

        /// Step 2: Owner executes the upgrade after the timelock has elapsed.
        fn execute_upgrade(ref self: ContractState) {
            self.assert_owner();
            let ready_at = self.pending_upgrade_ready_at.read();
            assert(ready_at > 0, 'no upgrade proposed');
            let now = starknet::get_block_timestamp();
            assert(now >= ready_at, 'upgrade timelock not elapsed');

            let new_class_hash = self.pending_upgrade_hash.read();
            // Clear pending state before upgrading
            self.pending_upgrade_ready_at.write(0);
            self.emit(UpgradeExecuted { new_class_hash });
            self.upgradeable.upgrade(new_class_hash);
        }

        /// Cancel a pending upgrade proposal.
        fn cancel_upgrade(ref self: ContractState) {
            self.assert_owner();
            let hash = self.pending_upgrade_hash.read();
            self.pending_upgrade_ready_at.write(0);
            self.emit(UpgradeCancelled { class_hash: hash });
        }

        /// Returns (pending_class_hash, ready_at_timestamp). ready_at=0 means no pending upgrade.
        fn get_pending_upgrade(self: @ContractState) -> (ClassHash, u64) {
            (self.pending_upgrade_hash.read(), self.pending_upgrade_ready_at.read())
        }

        // ── Security configuration ───────────────────────────────────────

        fn get_max_reward_cap(self: @ContractState) -> u256 {
            self.max_reward_cap.read()
        }

        fn set_max_reward_cap(ref self: ContractState, cap: u256) {
            self.assert_owner();
            self.max_reward_cap.write(cap);
        }

        fn get_max_batch_size(self: @ContractState) -> u32 {
            self.max_batch_size.read()
        }

        fn set_max_batch_size(ref self: ContractState, size: u32) {
            self.assert_owner();
            assert(size > 0, 'batch size must be > 0');
            assert(size <= 200, 'batch size too large');
            self.max_batch_size.write(size);
        }
    }
}
