use starknet::ContractAddress;

#[derive(Drop, Serde, Copy, starknet::Store, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
    Executed,
    Cancelled,
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct GuildInfo {
    pub creator: ContractAddress,
    pub name_hash: felt252,
    pub min_stake: u256,
    pub member_count: u32,
    pub total_staked: u256,
    pub created_at: u64,
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct ProposalInfo {
    pub proposer: ContractAddress,
    pub description_hash: felt252,
    pub yes_votes: u256,
    pub no_votes: u256,
    pub quorum: u256,
    pub deadline: u64,
    pub status: ProposalStatus,
    pub created_at: u64,
}

#[starknet::interface]
pub trait IGuildRegistry<TState> {
    fn create_guild(ref self: TState, name_hash: felt252, min_stake: u256) -> u256;
    fn join_guild(ref self: TState, guild_id: u256, stake_amount: u256);
    fn leave_guild(ref self: TState, guild_id: u256);
    fn get_guild(self: @TState, guild_id: u256) -> GuildInfo;
    fn get_guild_count(self: @TState) -> u256;
    fn is_member(self: @TState, guild_id: u256, member: ContractAddress) -> bool;
    fn get_member_stake(self: @TState, guild_id: u256, member: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IGuildDAO<TState> {
    fn propose(ref self: TState, guild_id: u256, description_hash: felt252, quorum: u256, deadline: u64) -> u256;
    fn vote(ref self: TState, proposal_id: u256, support: bool);
    fn execute(ref self: TState, proposal_id: u256);
    fn cancel(ref self: TState, proposal_id: u256);
    fn get_proposal(self: @TState, proposal_id: u256) -> ProposalInfo;
    fn get_proposal_count(self: @TState) -> u256;
    fn distribute(ref self: TState, guild_id: u256, amount: u256);
}

#[starknet::interface]
pub trait IERC20Transfer<TState> {
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}
