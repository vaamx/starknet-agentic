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
