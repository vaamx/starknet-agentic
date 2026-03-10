use starknet::ContractAddress;
use starknet::ClassHash;

#[starknet::interface]
pub trait IBuzzToken<TState> {
    // ── Mint / Burn ────────────────────────────────────────────────
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn burn(ref self: TState, amount: u256);

    // ── Minter management ──────────────────────────────────────────
    fn add_minter(ref self: TState, minter: ContractAddress);
    fn remove_minter(ref self: TState, minter: ContractAddress);
    fn is_minter(self: @TState, address: ContractAddress) -> bool;

    // ── Supply info ────────────────────────────────────────────────
    fn get_total_minted(self: @TState) -> u256;
    fn get_total_burned(self: @TState) -> u256;
    fn get_max_supply(self: @TState) -> u256;
    fn get_effective_max_supply(self: @TState) -> u256;

    // ── Halving ────────────────────────────────────────────────────
    fn get_current_epoch(self: @TState) -> u64;
    fn get_emission_multiplier_bps(self: @TState) -> u64;
    fn get_epoch_start_time(self: @TState) -> u64;

    // ── Emergency ──────────────────────────────────────────────────
    fn pause(ref self: TState);
    fn unpause(ref self: TState);
    fn is_paused(self: @TState) -> bool;

    // ── Ownership ──────────────────────────────────────────────────
    fn transfer_ownership(ref self: TState, new_owner: ContractAddress);
    fn get_owner(self: @TState) -> ContractAddress;

    // ── Timelocked Upgrade (5 min) ─────────────────────────────────
    fn propose_upgrade(ref self: TState, new_class_hash: ClassHash);
    fn execute_upgrade(ref self: TState);
    fn cancel_upgrade(ref self: TState);
    fn get_pending_upgrade(self: @TState) -> (ClassHash, u64);
}

/// On-chain reward distributor — trustless BUZZ minting.
/// Reporters call `report_action` to trigger rewards; the contract
/// enforces amounts, halving, and dedup. Only the distributor can mint.
#[starknet::interface]
pub trait IBuzzDistributor<TState> {
    // ── Core ─────────────────────────────────────────────────────────
    fn report_action(
        ref self: TState,
        action_type: felt252,
        recipient: ContractAddress,
        market_id: u256,
    );
    fn report_actions(
        ref self: TState,
        action_types: Span<felt252>,
        recipients: Span<ContractAddress>,
        market_ids: Span<u256>,
    );

    // ── Reporter management ──────────────────────────────────────────
    fn add_reporter(ref self: TState, reporter: ContractAddress);
    fn remove_reporter(ref self: TState, reporter: ContractAddress);
    fn is_reporter(self: @TState, address: ContractAddress) -> bool;

    // ── Reward configuration ─────────────────────────────────────────
    fn set_reward_amount(ref self: TState, action_type: felt252, amount: u256);
    fn get_reward_amount(self: @TState, action_type: felt252) -> u256;

    // ── View ─────────────────────────────────────────────────────────
    fn get_total_distributed(self: @TState) -> u256;
    fn get_total_actions(self: @TState) -> u256;
    fn get_buzz_token(self: @TState) -> ContractAddress;
    fn get_owner(self: @TState) -> ContractAddress;

    // ── Emergency ────────────────────────────────────────────────────
    fn pause(ref self: TState);
    fn unpause(ref self: TState);
    fn is_paused(self: @TState) -> bool;

    // ── Ownership ────────────────────────────────────────────────────
    fn transfer_ownership(ref self: TState, new_owner: ContractAddress);

    // ── Timelocked Upgrade (5 min) ───────────────────────────────────
    fn propose_upgrade(ref self: TState, new_class_hash: ClassHash);
    fn execute_upgrade(ref self: TState);
    fn cancel_upgrade(ref self: TState);
    fn get_pending_upgrade(self: @TState) -> (ClassHash, u64);

    // ── Security ─────────────────────────────────────────────────────
    fn get_max_reward_cap(self: @TState) -> u256;
    fn set_max_reward_cap(ref self: TState, cap: u256);
    fn get_max_batch_size(self: @TState) -> u32;
    fn set_max_batch_size(ref self: TState, size: u32);
}
