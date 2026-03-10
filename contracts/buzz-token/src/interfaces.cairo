use starknet::ContractAddress;

#[starknet::interface]
pub trait IBuzzToken<TState> {
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn burn(ref self: TState, amount: u256);
    fn add_minter(ref self: TState, minter: ContractAddress);
    fn remove_minter(ref self: TState, minter: ContractAddress);
    fn get_total_minted(self: @TState) -> u256;
    fn get_max_supply(self: @TState) -> u256;
    fn is_minter(self: @TState, address: ContractAddress) -> bool;
}
