#[starknet::contract]
pub mod BuzzToken {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use starknet::ClassHash;
    use core::num::traits::Zero;
    use openzeppelin::token::erc20::ERC20Component;
    use openzeppelin::token::erc20::ERC20HooksEmptyImpl;
    use openzeppelin::upgrades::UpgradeableComponent;
    use crate::interfaces::IBuzzToken;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);

    #[abi(embed_v0)]
    impl ERC20Impl = ERC20Component::ERC20Impl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;
    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

    // 100 million tokens with 18 decimals
    const MAX_SUPPLY: u256 = 100_000_000_000_000_000_000_000_000;

    // Halving epoch duration: ~6 months in seconds (182.5 days)
    const EPOCH_DURATION_SECS: u64 = 15_768_000;

    // Upgrade timelock: 5 minutes
    const UPGRADE_DELAY_SECS: u64 = 300;

    // Basis points: 10_000 = 100%
    const BPS_FULL: u64 = 10_000;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        owner: ContractAddress,
        minters: Map<ContractAddress, bool>,
        total_minted: u256,
        total_burned: u256,
        max_supply: u256,
        paused: bool,
        epoch_start_time: u64,
        // Timelocked upgrade
        pending_upgrade_hash: ClassHash,
        pending_upgrade_ready_at: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        MinterAdded: MinterAdded,
        MinterRemoved: MinterRemoved,
        OwnershipTransferred: OwnershipTransferred,
        Paused: Paused,
        Unpaused: Unpaused,
        HalvingEpoch: HalvingEpoch,
        UpgradeProposed: UpgradeProposed,
        UpgradeCancelled: UpgradeCancelled,
        UpgradeExecuted: UpgradeExecuted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MinterAdded {
        pub minter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MinterRemoved {
        pub minter: ContractAddress,
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
    pub struct HalvingEpoch {
        pub epoch: u64,
        pub multiplier_bps: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeProposed {
        pub new_class_hash: ClassHash,
        pub ready_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeCancelled {
        pub class_hash: ClassHash,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpgradeExecuted {
        pub new_class_hash: ClassHash,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        assert(!owner.is_zero(), 'owner cannot be zero');
        self.erc20.initializer("Buzz Token", "BUZZ");
        self.owner.write(owner);
        self.max_supply.write(MAX_SUPPLY);
        self.total_minted.write(0);
        self.total_burned.write(0);
        self.paused.write(false);
        self.epoch_start_time.write(starknet::get_block_timestamp());
        self.pending_upgrade_ready_at.write(0);
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_owner(self: @ContractState) {
            let caller = starknet::get_caller_address();
            assert(caller == self.owner.read(), 'only owner');
        }

        fn assert_not_paused(self: @ContractState) {
            assert(!self.paused.read(), 'contract is paused');
        }

        fn compute_current_epoch(self: @ContractState) -> u64 {
            let now = starknet::get_block_timestamp();
            let start = self.epoch_start_time.read();
            if now <= start {
                return 0;
            }
            (now - start) / EPOCH_DURATION_SECS
        }

        fn compute_emission_multiplier_bps(self: @ContractState) -> u64 {
            let epoch = self.compute_current_epoch();
            let capped_epoch = if epoch > 10 { 10 } else { epoch };
            let mut multiplier = BPS_FULL;
            let mut i: u64 = 0;
            while i < capped_epoch {
                multiplier = multiplier / 2;
                i += 1;
            };
            if multiplier < 10 {
                10 // floor at 0.1%
            } else {
                multiplier
            }
        }
    }

    #[abi(embed_v0)]
    impl BuzzTokenImpl of IBuzzToken<ContractState> {
        // ── Mint ───────────────────────────────────────────────────────
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.assert_not_paused();
            let caller = starknet::get_caller_address();
            let is_owner = caller == self.owner.read();
            let is_minter = self.minters.entry(caller).read();
            assert(is_owner || is_minter, 'only owner or minter can mint');
            assert(!to.is_zero(), 'cannot mint to zero address');

            let new_total = self.total_minted.read() + amount;
            assert(new_total <= self.max_supply.read(), 'exceeds max supply');

            self.total_minted.write(new_total);
            self.erc20.mint(to, amount);
        }

        // ── Burn ───────────────────────────────────────────────────────
        fn burn(ref self: ContractState, amount: u256) {
            self.assert_not_paused();
            let caller = starknet::get_caller_address();
            self.total_burned.write(self.total_burned.read() + amount);
            self.erc20.burn(caller, amount);
        }

        // ── Minter management ──────────────────────────────────────────
        fn add_minter(ref self: ContractState, minter: ContractAddress) {
            self.assert_owner();
            assert(!minter.is_zero(), 'minter cannot be zero');
            self.minters.entry(minter).write(true);
            self.emit(MinterAdded { minter });
        }

        fn remove_minter(ref self: ContractState, minter: ContractAddress) {
            self.assert_owner();
            self.minters.entry(minter).write(false);
            self.emit(MinterRemoved { minter });
        }

        fn is_minter(self: @ContractState, address: ContractAddress) -> bool {
            self.minters.entry(address).read()
        }

        // ── Supply info ────────────────────────────────────────────────
        fn get_total_minted(self: @ContractState) -> u256 {
            self.total_minted.read()
        }

        fn get_total_burned(self: @ContractState) -> u256 {
            self.total_burned.read()
        }

        fn get_max_supply(self: @ContractState) -> u256 {
            self.max_supply.read()
        }

        fn get_effective_max_supply(self: @ContractState) -> u256 {
            self.max_supply.read() - self.total_burned.read()
        }

        // ── Halving ────────────────────────────────────────────────────
        fn get_current_epoch(self: @ContractState) -> u64 {
            InternalImpl::compute_current_epoch(self)
        }

        fn get_emission_multiplier_bps(self: @ContractState) -> u64 {
            InternalImpl::compute_emission_multiplier_bps(self)
        }

        fn get_epoch_start_time(self: @ContractState) -> u64 {
            self.epoch_start_time.read()
        }

        // ── Emergency ──────────────────────────────────────────────────
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

        // ── Ownership ──────────────────────────────────────────────────
        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            self.assert_owner();
            assert(!new_owner.is_zero(), 'new owner cannot be zero');
            let previous_owner = self.owner.read();
            self.owner.write(new_owner);
            self.emit(OwnershipTransferred { previous_owner, new_owner });
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        // ── Timelocked Upgrade (5 min) ─────────────────────────────────
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
    }
}
