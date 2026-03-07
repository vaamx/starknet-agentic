use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
use crate::interfaces::{IGuildRegistryDispatcher, IGuildRegistryDispatcherTrait};

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

// We reuse AgentToken from bonding-curve as a mock ERC20
// For standalone testing, define a minimal mock inline
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

fn setup() -> (IGuildRegistryDispatcher, ContractAddress) {
    start_cheat_block_timestamp_global(1000);

    let token = deploy_mock_token();
    let registry = deploy_guild_registry(token);

    let mock = IMockTokenDispatcher { contract_address: token };

    // Fund members
    start_cheat_caller_address(token, OWNER());
    mock.mint(MEMBER1(), 10000);
    mock.mint(MEMBER2(), 10000);
    stop_cheat_caller_address(token);

    // Approve
    start_cheat_caller_address(token, MEMBER1());
    mock.approve(registry.contract_address, 10000);
    stop_cheat_caller_address(token);

    start_cheat_caller_address(token, MEMBER2());
    mock.approve(registry.contract_address, 10000);
    stop_cheat_caller_address(token);

    (registry, token)
}

#[test]
fn test_create_guild() {
    let (registry, _) = setup();

    start_cheat_caller_address(registry.contract_address, CREATOR());
    let guild_id = registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    assert(guild_id == 1, 'guild id should be 1');

    let guild = registry.get_guild(1);
    assert(guild.creator == CREATOR(), 'wrong creator');
    assert(guild.min_stake == 100, 'wrong min stake');
    assert(guild.member_count == 0, 'should have 0 members');
}

#[test]
fn test_join_guild() {
    let (registry, _) = setup();

    start_cheat_caller_address(registry.contract_address, CREATOR());
    registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.join_guild(1, 200);
    stop_cheat_caller_address(registry.contract_address);

    assert(registry.is_member(1, MEMBER1()), 'should be member');
    assert(registry.get_member_stake(1, MEMBER1()) == 200, 'wrong stake');

    let guild = registry.get_guild(1);
    assert(guild.member_count == 1, 'should have 1 member');
    assert(guild.total_staked == 200, 'wrong total staked');
}

#[test]
fn test_leave_guild() {
    let (registry, _) = setup();

    start_cheat_caller_address(registry.contract_address, CREATOR());
    registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.join_guild(1, 200);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.leave_guild(1);
    stop_cheat_caller_address(registry.contract_address);

    assert(!registry.is_member(1, MEMBER1()), 'should not be member');
    let guild = registry.get_guild(1);
    assert(guild.member_count == 0, 'should have 0 members');
}

#[test]
fn test_multiple_members() {
    let (registry, _) = setup();

    start_cheat_caller_address(registry.contract_address, CREATOR());
    registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.join_guild(1, 200);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER2());
    registry.join_guild(1, 300);
    stop_cheat_caller_address(registry.contract_address);

    let guild = registry.get_guild(1);
    assert(guild.member_count == 2, 'should have 2 members');
    assert(guild.total_staked == 500, 'wrong total staked');
}

#[test]
#[should_panic(expected: 'stake below minimum')]
fn test_stake_below_minimum() {
    let (registry, _) = setup();

    start_cheat_caller_address(registry.contract_address, CREATOR());
    registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.join_guild(1, 50); // below min_stake of 100
}

#[test]
#[should_panic(expected: 'already a member')]
fn test_cannot_join_twice() {
    let (registry, _) = setup();

    start_cheat_caller_address(registry.contract_address, CREATOR());
    registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.join_guild(1, 200);
    registry.join_guild(1, 200);
}

#[test]
#[should_panic(expected: 'not a member')]
fn test_cannot_leave_if_not_member() {
    let (registry, _) = setup();

    start_cheat_caller_address(registry.contract_address, CREATOR());
    registry.create_guild('forecasters', 100);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, MEMBER1());
    registry.leave_guild(1);
}

#[test]
fn test_guild_counter() {
    let (registry, _) = setup();

    assert(registry.get_guild_count() == 0, 'should start at 0');

    start_cheat_caller_address(registry.contract_address, CREATOR());
    registry.create_guild('guild1', 100);
    registry.create_guild('guild2', 200);
    stop_cheat_caller_address(registry.contract_address);

    assert(registry.get_guild_count() == 2, 'should be 2');
}
