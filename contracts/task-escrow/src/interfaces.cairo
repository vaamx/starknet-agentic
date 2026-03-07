use starknet::ContractAddress;

#[derive(Drop, Serde, Copy, starknet::Store, PartialEq)]
pub enum TaskStatus {
    Open,
    Assigned,
    Submitted,
    Approved,
    Disputed,
    Cancelled,
    Settled,
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct TaskInfo {
    pub poster: ContractAddress,
    pub description_hash: felt252,
    pub reward_amount: u256,
    pub deadline: u64,
    pub required_validators: u8,
    pub status: TaskStatus,
    pub assignee: ContractAddress,
    pub proof_hash: felt252,
    pub created_at: u64,
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct BidInfo {
    pub bidder: ContractAddress,
    pub bid_amount: u256,
    pub timestamp: u64,
}

#[derive(Drop, Serde, Copy, PartialEq)]
pub enum DisputeRuling {
    /// Assignee delivered valid work — release reward to assignee
    AssigneeWins,
    /// Poster's dispute upheld — refund reward to poster
    PosterWins,
    /// Neither party clearly right — split reward equally
    Split,
}

#[starknet::interface]
pub trait ITaskEscrow<TState> {
    fn post_task(
        ref self: TState,
        description_hash: felt252,
        reward_amount: u256,
        deadline: u64,
        required_validators: u8,
    ) -> u256;

    fn bid_task(ref self: TState, task_id: u256, bid_amount: u256);

    fn accept_bid(ref self: TState, task_id: u256, bidder: ContractAddress);

    fn submit_proof(ref self: TState, task_id: u256, proof_hash: felt252);

    fn approve_task(ref self: TState, task_id: u256);

    fn dispute_task(ref self: TState, task_id: u256, reason_hash: felt252);

    fn cancel_task(ref self: TState, task_id: u256);

    /// Owner-arbitrated dispute resolution. Settles a disputed task by distributing
    /// escrowed funds according to the ruling.
    fn resolve_dispute(ref self: TState, task_id: u256, ruling: DisputeRuling);

    /// Fallback: either party can force-settle a dispute after the dispute window
    /// expires (dispute_deadline_seconds after the dispute was filed). Refunds poster.
    fn force_settle_dispute(ref self: TState, task_id: u256);

    fn get_task(self: @TState, task_id: u256) -> TaskInfo;

    fn get_bid_count(self: @TState, task_id: u256) -> u256;

    fn get_bid(self: @TState, task_id: u256, index: u256) -> BidInfo;

    fn get_task_count(self: @TState) -> u256;

    fn get_dispute_deadline(self: @TState, task_id: u256) -> u64;
}

#[starknet::interface]
pub trait IERC20Transfer<TState> {
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::interface]
pub trait IIdentityCheck<TState> {
    fn agent_exists(self: @TState, agent_id: u256) -> bool;
}
