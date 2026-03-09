use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
use crate::interfaces::{IStarkCastFeedDispatcher, IStarkCastFeedDispatcherTrait};

fn OWNER() -> ContractAddress {
    0xAA.try_into().unwrap()
}

fn ALICE() -> ContractAddress {
    0xBB.try_into().unwrap()
}

fn BOB() -> ContractAddress {
    0xCC.try_into().unwrap()
}

fn CHARLIE() -> ContractAddress {
    0xDD.try_into().unwrap()
}

// ── Mock ERC-20 ──────────────────────────────────────────────────────────

#[starknet::contract]
mod MockTipToken {
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

    #[external(v0)]
    fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
        self.balances.entry(account).read()
    }
}

#[starknet::interface]
trait IMockToken<TState> {
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
}

// ── Deployment helpers ───────────────────────────────────────────────────

fn deploy_mock_token() -> ContractAddress {
    let contract = declare("MockTipToken").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

fn deploy_feed(token: ContractAddress) -> IStarkCastFeedDispatcher {
    let contract = declare("StarkCastFeed").unwrap().contract_class();
    let mut calldata = array![];
    OWNER().serialize(ref calldata);
    token.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    IStarkCastFeedDispatcher { contract_address: addr }
}

fn setup() -> (IStarkCastFeedDispatcher, ContractAddress) {
    start_cheat_block_timestamp_global(1000);

    let token = deploy_mock_token();
    let feed = deploy_feed(token);

    let mock = IMockTokenDispatcher { contract_address: token };

    // Fund users with STRK for tipping
    start_cheat_caller_address(token, OWNER());
    mock.mint(ALICE(), 10000);
    mock.mint(BOB(), 10000);
    mock.mint(CHARLIE(), 10000);
    stop_cheat_caller_address(token);

    // Approve the feed contract to transfer on behalf of users
    start_cheat_caller_address(token, ALICE());
    mock.approve(feed.contract_address, 10000);
    stop_cheat_caller_address(token);

    start_cheat_caller_address(token, BOB());
    mock.approve(feed.contract_address, 10000);
    stop_cheat_caller_address(token);

    start_cheat_caller_address(token, CHARLIE());
    mock.approve(feed.contract_address, 10000);
    stop_cheat_caller_address(token);

    (feed, token)
}

// ── Post tests ───────────────────────────────────────────────────────────

#[test]
fn test_create_post() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    let post_id = feed.post('content_hash_1', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    assert(post_id == 1, 'post id should be 1');
    assert(feed.get_post_count() == 1, 'count should be 1');

    let post = feed.get_post(1);
    assert(post.author == ALICE(), 'wrong author');
    assert(post.content_hash == 'content_hash_1', 'wrong content hash');
    assert(post.proof_hash == 0, 'proof should be 0');
    assert(post.like_count == 0, 'likes should be 0');
    assert(post.reply_to == 0, 'reply_to should be 0');
}

#[test]
fn test_post_with_proof() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    let post_id = feed.post('content_1', 'proof_hash_1', 0);
    stop_cheat_caller_address(feed.contract_address);

    let post = feed.get_post(post_id);
    assert(post.proof_hash == 'proof_hash_1', 'wrong proof hash');
}

#[test]
fn test_reply_to_post() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    let parent_id = feed.post('original_post', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    start_cheat_caller_address(feed.contract_address, BOB());
    let reply_id = feed.post('reply_content', 0, parent_id);
    stop_cheat_caller_address(feed.contract_address);

    assert(reply_id == 2, 'reply id should be 2');
    let reply = feed.get_post(reply_id);
    assert(reply.reply_to == parent_id, 'wrong reply_to');
    assert(reply.author == BOB(), 'wrong reply author');
}

#[test]
#[should_panic(expected: 'parent post not found')]
fn test_reply_to_nonexistent() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('orphan_reply', 0, 999); // post 999 doesn't exist
}

#[test]
#[should_panic(expected: 'content hash required')]
fn test_empty_content_hash() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post(0, 0, 0);
}

// ── Like tests ───────────────────────────────────────────────────────────

#[test]
fn test_like_post() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('content_1', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    assert(!feed.has_liked(1, BOB()), 'should not be liked yet');

    start_cheat_caller_address(feed.contract_address, BOB());
    feed.toggle_like(1);
    stop_cheat_caller_address(feed.contract_address);

    assert(feed.has_liked(1, BOB()), 'should be liked');
    assert(feed.get_post(1).like_count == 1, 'like count should be 1');
}

#[test]
fn test_unlike_post() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('content_1', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    // Like then unlike
    start_cheat_caller_address(feed.contract_address, BOB());
    feed.toggle_like(1);
    feed.toggle_like(1);
    stop_cheat_caller_address(feed.contract_address);

    assert(!feed.has_liked(1, BOB()), 'should be unliked');
    assert(feed.get_post(1).like_count == 0, 'like count should be 0');
}

#[test]
fn test_multiple_likers() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('content_1', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    start_cheat_caller_address(feed.contract_address, BOB());
    feed.toggle_like(1);
    stop_cheat_caller_address(feed.contract_address);

    start_cheat_caller_address(feed.contract_address, CHARLIE());
    feed.toggle_like(1);
    stop_cheat_caller_address(feed.contract_address);

    assert(feed.get_post(1).like_count == 2, 'like count should be 2');
}

#[test]
#[should_panic(expected: 'post not found')]
fn test_like_nonexistent() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.toggle_like(999);
}

// ── Tip tests ────────────────────────────────────────────────────────────

#[test]
fn test_tip_post() {
    let (feed, token) = setup();
    let mock = IMockTokenDispatcher { contract_address: token };

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('content_1', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    let alice_before = mock.balance_of(ALICE());

    start_cheat_caller_address(feed.contract_address, BOB());
    feed.tip(1, 500);
    stop_cheat_caller_address(feed.contract_address);

    // Post tip total updated
    assert(feed.get_post(1).tip_total == 500, 'tip total should be 500');
    // Author cumulative tips updated
    assert(feed.get_author_tips(ALICE()) == 500, 'author tips should be 500');
    // Alice received the tokens
    assert(mock.balance_of(ALICE()) == alice_before + 500, 'alice should receive tip');
}

#[test]
fn test_multiple_tips() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('content_1', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    start_cheat_caller_address(feed.contract_address, BOB());
    feed.tip(1, 300);
    stop_cheat_caller_address(feed.contract_address);

    start_cheat_caller_address(feed.contract_address, CHARLIE());
    feed.tip(1, 200);
    stop_cheat_caller_address(feed.contract_address);

    assert(feed.get_post(1).tip_total == 500, 'tip total should be 500');
    assert(feed.get_author_tips(ALICE()) == 500, 'author tips should be 500');
}

#[test]
#[should_panic(expected: 'cannot tip yourself')]
fn test_cannot_tip_self() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('content_1', 0, 0);
    feed.tip(1, 100);
}

#[test]
#[should_panic(expected: 'amount must be > 0')]
fn test_tip_zero_amount() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('content_1', 0, 0);
    stop_cheat_caller_address(feed.contract_address);

    start_cheat_caller_address(feed.contract_address, BOB());
    feed.tip(1, 0);
}

#[test]
#[should_panic(expected: 'post not found')]
fn test_tip_nonexistent() {
    let (feed, _) = setup();

    start_cheat_caller_address(feed.contract_address, BOB());
    feed.tip(999, 100);
}

// ── Counter & misc tests ─────────────────────────────────────────────────

#[test]
fn test_post_counter() {
    let (feed, _) = setup();

    assert(feed.get_post_count() == 0, 'should start at 0');

    start_cheat_caller_address(feed.contract_address, ALICE());
    feed.post('post1', 0, 0);
    feed.post('post2', 0, 0);
    feed.post('post3', 'proof_3', 0);
    stop_cheat_caller_address(feed.contract_address);

    assert(feed.get_post_count() == 3, 'should be 3');
}

#[test]
fn test_tip_token_getter() {
    let (feed, token) = setup();
    assert(feed.get_tip_token() == token, 'wrong tip token');
}
