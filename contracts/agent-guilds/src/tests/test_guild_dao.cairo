use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
use crate::interfaces::{
    IGuildRegistryDispatcher, IGuildRegistryDispatcherTrait, IGuildDAODispatcher,
    IGuildDAODispatcherTrait, ProposalStatus,
};

fn OWNER() -> ContractAddress {
    0xAA.try_into().unwrap()
}

fn CREATOR() -> ContractAddress {
    0xBB.try_into().unwrap()
}

fn MEMBER1() -> ContractAddress {
    0xCC.try_into().unwrap()
}

fn MEMBER2() -> ContractAddress {
    0xDD.try_into().unwrap()
}

fn NON_MEMBER() -> ContractAddress {
    0xEE.try_into().unwrap()
}

// Reuse MockStakeToken from test_guild_registry
#[starknet::contract]
mod MockStakeToken {
    use starknet::storage::*;
    use starknet::ContractAddress;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[external(v0)]
    fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
        let current = self.balances.entry(to).read();
        self.balances.entry(to).write(current + amount);
    }

    #[external(v0)]
    fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
        let caller = starknet::get_caller_address();
        self.allowances.entry((caller, spender)).write(amount);
        true
    }

    #[external(v0)]
    fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
        let caller = starknet::get_caller_address();
        let balance = self.balances.entry(caller).read();
        assert(balance >= amount, 'insufficient balance');
        self.balances.entry(caller).write(balance - amount);
        let rb = self.balances.entry(recipient).read();
        self.balances.entry(recipient).write(rb + amount);
        true
    }

    #[external(v0)]
    fn transfer_from(
        ref self: ContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool {
        let caller = starknet::get_caller_address();
        let allowance = self.allowances.entry((sender, caller)).read();
        assert(allowance >= amount, 'insufficient allowance');
        self.allowances.entry((sender, caller)).write(allowance - amount);
        let balance = self.balances.entry(sender).read();
        assert(balance >= amount, 'insufficient balance');
        self.balances.entry(sender).write(balance - amount);
        let rb = self.balances.entry(recipient).read();
        self.balances.entry(recipient).write(rb + amount);
        true
    }
}

#[starknet::interface]
trait IMockToken<TState> {
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

fn deploy_mock_token() -> ContractAddress {
    let contract = declare("MockStakeToken").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

fn deploy_guild_registry(token: ContractAddress) -> IGuildRegistryDispatcher {
    let contract = declare("GuildRegistry").unwrap().contract_class();
    let mut calldata = array![];
    OWNER().serialize(ref calldata);
    token.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    IGuildRegistryDispatcher { contract_address: addr }
}

fn deploy_guild_dao(registry: ContractAddress) -> IGuildDAODispatcher {
    let contract = declare("GuildDAO").unwrap().contract_class();
    let mut calldata = array![];
    registry.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    IGuildDAODispatcher { contract_address: addr }
}

/// Full setup: deploy token, registry, dao; fund and register members in a guild.
/// Returns (dao, registry, token, guild_id).
fn setup() -> (IGuildDAODispatcher, IGuildRegistryDispatcher, ContractAddress, u256) {
    // Set block timestamp to 1000
    start_cheat_block_timestamp_global(1000);

    let token = deploy_mock_token();
    let registry = deploy_guild_registry(token);
    let dao = deploy_guild_dao(registry.contract_address);

    let mock = IMockTokenDispatcher { contract_address: token };

    // Fund members
    start_cheat_caller_address(token, OWNER());
    mock.mint(MEMBER1(), 10000);
    mock.mint(MEMBER2(), 10000);
    stop_cheat_caller_address(token);

    // Approve registry to spend tokens
    start_cheat_caller_address(token, MEMBER1());
    mock.approve(registry.contract_address, 10000);
    stop_cheat_caller_address(token);

    start_cheat_caller_address(token, MEMBER2());
    mock.approve(registry.contract_address, 10000);
    stop_cheat_caller_address(token);

    // Create guild
    start_cheat_caller_address(registry.contract_address, CREATOR());
    let guild_id = registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    // MEMBER1 joins guild with stake of 500
    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.join_guild(guild_id, 500);
    stop_cheat_caller_address(registry.contract_address);

    // MEMBER2 joins guild with stake of 300
    start_cheat_caller_address(registry.contract_address, MEMBER2());
    registry.join_guild(guild_id, 300);
    stop_cheat_caller_address(registry.contract_address);

    (dao, registry, token, guild_id)
}

// -----------------------------------------------------------------------
// Happy-path tests
// -----------------------------------------------------------------------

#[test]
fn test_propose() {
    let (dao, _, _, guild_id) = setup();

    // MEMBER1 creates a proposal with deadline at timestamp 2000
    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'upgrade_model', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    assert(proposal_id == 1, 'proposal id should be 1');
    assert(dao.get_proposal_count() == 1, 'count should be 1');

    let info = dao.get_proposal(proposal_id);
    assert(info.proposer == MEMBER1(), 'wrong proposer');
    assert(info.description_hash == 'upgrade_model', 'wrong description');
    assert(info.quorum == 100, 'wrong quorum');
    assert(info.deadline == 2000, 'wrong deadline');
    assert(info.yes_votes == 0, 'yes votes should be 0');
    assert(info.no_votes == 0, 'no votes should be 0');
    assert(info.status == ProposalStatus::Active, 'should be active');
    assert(info.created_at == 1000, 'wrong created_at');
}

#[test]
fn test_vote_yes() {
    let (dao, registry, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'upgrade_model', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    // MEMBER2 votes yes — weight should equal their stake (300)
    start_cheat_caller_address(dao.contract_address, MEMBER2());
    dao.vote(proposal_id, true);
    stop_cheat_caller_address(dao.contract_address);

    let info = dao.get_proposal(proposal_id);
    let member2_stake = registry.get_member_stake(guild_id, MEMBER2());
    assert(info.yes_votes == member2_stake, 'yes votes should equal stake');
    assert(info.yes_votes == 300, 'yes votes should be 300');
    assert(info.no_votes == 0, 'no votes should be 0');
}

#[test]
fn test_vote_no() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'upgrade_model', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    // MEMBER2 votes no — weight should equal their stake (300)
    start_cheat_caller_address(dao.contract_address, MEMBER2());
    dao.vote(proposal_id, false);
    stop_cheat_caller_address(dao.contract_address);

    let info = dao.get_proposal(proposal_id);
    assert(info.no_votes == 300, 'no votes should be 300');
    assert(info.yes_votes == 0, 'yes votes should be 0');
}

#[test]
fn test_execute_passed() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'upgrade_model', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    // Both members vote yes: 500 + 300 = 800, quorum = 100, yes > no
    start_cheat_caller_address(dao.contract_address, MEMBER1());
    dao.vote(proposal_id, true);
    stop_cheat_caller_address(dao.contract_address);

    start_cheat_caller_address(dao.contract_address, MEMBER2());
    dao.vote(proposal_id, true);
    stop_cheat_caller_address(dao.contract_address);

    // Advance time past deadline
    start_cheat_block_timestamp_global(3000);

    // Execute — should pass
    dao.execute(proposal_id);

    let info = dao.get_proposal(proposal_id);
    assert(info.status == ProposalStatus::Executed, 'should be executed');
}

#[test]
fn test_execute_rejected() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'bad_idea', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    // Both members vote no: 500 + 300 = 800, quorum met but yes < no
    start_cheat_caller_address(dao.contract_address, MEMBER1());
    dao.vote(proposal_id, false);
    stop_cheat_caller_address(dao.contract_address);

    start_cheat_caller_address(dao.contract_address, MEMBER2());
    dao.vote(proposal_id, false);
    stop_cheat_caller_address(dao.contract_address);

    // Advance time past deadline
    start_cheat_block_timestamp_global(3000);

    dao.execute(proposal_id);

    let info = dao.get_proposal(proposal_id);
    assert(info.status == ProposalStatus::Rejected, 'should be rejected');
}

#[test]
fn test_cancel_proposal() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'cancel_me', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    // Proposer cancels
    start_cheat_caller_address(dao.contract_address, MEMBER1());
    dao.cancel(proposal_id);
    stop_cheat_caller_address(dao.contract_address);

    let info = dao.get_proposal(proposal_id);
    assert(info.status == ProposalStatus::Cancelled, 'should be cancelled');
}

// -----------------------------------------------------------------------
// Failure tests
// -----------------------------------------------------------------------

#[test]
#[should_panic(expected: 'already voted')]
fn test_cannot_vote_twice() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'upgrade_model', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    start_cheat_caller_address(dao.contract_address, MEMBER2());
    dao.vote(proposal_id, true);
    dao.vote(proposal_id, false); // should panic
}

#[test]
#[should_panic(expected: 'not a guild member')]
fn test_non_member_cannot_propose() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, NON_MEMBER());
    dao.propose(guild_id, 'hack', 100, 2000);
}

#[test]
#[should_panic(expected: 'voting not ended')]
fn test_cannot_execute_before_deadline() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'upgrade_model', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    dao.vote(proposal_id, true);
    stop_cheat_caller_address(dao.contract_address);

    // Do NOT advance time — still at timestamp 1000, deadline is 2000
    dao.execute(proposal_id); // should panic
}

#[test]
#[should_panic(expected: 'only proposer can cancel')]
fn test_non_proposer_cannot_cancel() {
    let (dao, _, _, guild_id) = setup();

    start_cheat_caller_address(dao.contract_address, MEMBER1());
    let proposal_id = dao.propose(guild_id, 'upgrade_model', 100, 2000);
    stop_cheat_caller_address(dao.contract_address);

    // MEMBER2 tries to cancel MEMBER1's proposal
    start_cheat_caller_address(dao.contract_address, MEMBER2());
    dao.cancel(proposal_id); // should panic
}
