use starknet::ContractAddress;

#[derive(Drop, Serde, Copy, starknet::Store, PartialEq)]
pub enum CurveType {
    Linear,
    Quadratic,
    Sigmoid,
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct LaunchInfo {
    pub token: ContractAddress,
    pub curve: ContractAddress,
    pub creator: ContractAddress,
    pub curve_type: CurveType,
    pub agent_id: u256,
    pub created_at: u64,
}

#[starknet::interface]
pub trait IAgentToken<TState> {
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn burn(ref self: TState, from: ContractAddress, amount: u256);
    fn set_curve(ref self: TState, curve: ContractAddress);
}

#[starknet::interface]
pub trait IBondingCurve<TState> {
    fn buy(ref self: TState, amount: u256) -> u256;
    fn sell(ref self: TState, amount: u256) -> u256;
    fn get_buy_price(self: @TState, amount: u256) -> u256;
    fn get_sell_price(self: @TState, amount: u256) -> u256;
    fn get_current_supply(self: @TState) -> u256;
    fn get_reserve_balance(self: @TState) -> u256;
    fn get_curve_type(self: @TState) -> CurveType;
    fn get_fee_bps(self: @TState) -> u16;
    fn get_fees_collected(self: @TState) -> u256;
    fn withdraw_fees(ref self: TState, recipient: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IStarkMintFactory<TState> {
    fn launch_token(
        ref self: TState,
        name: felt252,
        symbol: felt252,
        curve_type: CurveType,
        fee_bps: u16,
        agent_id: u256,
    ) -> (ContractAddress, ContractAddress);

    fn get_launch(self: @TState, index: u256) -> LaunchInfo;
    fn get_launch_count(self: @TState) -> u256;
}

#[starknet::interface]
pub trait IERC20Transfer<TState> {
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
}
