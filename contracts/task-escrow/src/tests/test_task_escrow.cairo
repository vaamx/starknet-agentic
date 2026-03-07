use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
use crate::interfaces::{
    ITaskEscrowDispatcher, ITaskEscrowDispatcherTrait, TaskStatus, DisputeRuling,
};

fn OWNER() -> ContractAddress {
    0xAA.try_into().unwrap()
}

fn POSTER() -> ContractAddress {
    0xBB.try_into().unwrap()
}

fn BIDDER() -> ContractAddress {
    0xCC.try_into().unwrap()
}

fn BIDDER2() -> ContractAddress {
    0xDD.try_into().unwrap()
}

#[starknet::interface]
trait IMockERC20<TState> {
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
}

fn deploy_mock_token() -> ContractAddress {
    let contract = declare("MockERC20").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

fn deploy_escrow(token: ContractAddress) -> ITaskEscrowDispatcher {
    let contract = declare("TaskEscrow").unwrap().contract_class();
    let mut calldata = array![];
    OWNER().serialize(ref calldata);
    token.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    ITaskEscrowDispatcher { contract_address: addr }
}

fn setup() -> (ITaskEscrowDispatcher, ContractAddress) {
    start_cheat_block_timestamp_global(1000);

    let token = deploy_mock_token();
    let escrow = deploy_escrow(token);

    // Mint tokens to poster
    let mock = IMockERC20Dispatcher { contract_address: token };
    start_cheat_caller_address(token, OWNER());
    mock.mint(POSTER(), 10000);
    stop_cheat_caller_address(token);

    // Approve escrow to spend poster's tokens
    start_cheat_caller_address(token, POSTER());
    mock.approve(escrow.contract_address, 10000);
    stop_cheat_caller_address(token);

    (escrow, token)
}

#[test]
fn test_post_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    let task_id = escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    assert(task_id == 1, 'task id should be 1');

    let task = escrow.get_task(1);
    assert(task.poster == POSTER(), 'wrong poster');
    assert(task.reward_amount == 100, 'wrong reward');
    assert(task.deadline == 2000, 'wrong deadline');
    assert(task.status == TaskStatus::Open, 'should be open');
}

#[test]
fn test_bid_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    assert(escrow.get_bid_count(1) == 1, 'bid count should be 1');
    let bid = escrow.get_bid(1, 0);
    assert(bid.bidder == BIDDER(), 'wrong bidder');
    assert(bid.bid_amount == 80, 'wrong bid amount');
}

#[test]
fn test_multiple_bids() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER2());
    escrow.bid_task(1, 60);
    stop_cheat_caller_address(escrow.contract_address);

    assert(escrow.get_bid_count(1) == 2, 'bid count should be 2');
}

#[test]
fn test_accept_bid_and_submit_proof() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    // Accept bid
    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Assigned, 'should be assigned');
    assert(task.assignee == BIDDER(), 'wrong assignee');

    // Submit proof
    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.submit_proof(1, 'proof_hash');
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Submitted, 'should be submitted');
    assert(task.proof_hash == 'proof_hash', 'wrong proof hash');
}

#[test]
fn test_full_lifecycle_approve() {
    let (escrow, token) = setup();
    let mock = IMockERC20Dispatcher { contract_address: token };

    let bidder_balance_before = mock.balance_of(BIDDER());

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.submit_proof(1, 'proof_hash');
    stop_cheat_caller_address(escrow.contract_address);

    // Approve → release funds
    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.approve_task(1);
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Approved, 'should be approved');

    let bidder_balance_after = mock.balance_of(BIDDER());
    assert(bidder_balance_after == bidder_balance_before + 100, 'bidder should receive reward');
}

#[test]
fn test_dispute_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.submit_proof(1, 'proof_hash');
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.dispute_task(1, 'dispute_reason');
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Disputed, 'should be disputed');
}

#[test]
fn test_cancel_task_refunds() {
    let (escrow, token) = setup();
    let mock = IMockERC20Dispatcher { contract_address: token };

    let poster_balance_before = mock.balance_of(POSTER());

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    let poster_balance_mid = mock.balance_of(POSTER());
    assert(poster_balance_mid == poster_balance_before - 100, 'should deduct reward');

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.cancel_task(1);
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Cancelled, 'should be cancelled');

    let poster_balance_after = mock.balance_of(POSTER());
    assert(poster_balance_after == poster_balance_before, 'should refund');
}

#[test]
#[should_panic(expected: 'only poster can accept')]
fn test_non_poster_cannot_accept() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    // Non-poster tries to accept
    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.accept_bid(1, BIDDER());
}

#[test]
#[should_panic(expected: 'only assignee can submit')]
fn test_non_assignee_cannot_submit() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    // Non-assignee tries to submit
    start_cheat_caller_address(escrow.contract_address, BIDDER2());
    escrow.submit_proof(1, 'proof_hash');
}

#[test]
#[should_panic(expected: 'poster cannot bid')]
fn test_poster_cannot_bid_own_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    escrow.bid_task(1, 80);
}

#[test]
#[should_panic(expected: 'can only cancel open tasks')]
fn test_cannot_cancel_assigned_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    escrow.cancel_task(1);
}

#[test]
#[should_panic(expected: 'deadline must be future')]
fn test_deadline_must_be_future() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    // timestamp is 1000, deadline is 500 (past)
    escrow.post_task('task_desc_hash', 100, 500, 1);
}

#[test]
fn test_task_counter() {
    let (escrow, _) = setup();

    assert(escrow.get_task_count() == 0, 'should start at 0');

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('hash1', 50, 2000, 1);
    escrow.post_task('hash2', 50, 3000, 2);
    stop_cheat_caller_address(escrow.contract_address);

    assert(escrow.get_task_count() == 2, 'should be 2');
}

#[test]
#[should_panic(expected: 'task expired')]
fn test_cannot_bid_expired_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    // Move time past deadline
    start_cheat_block_timestamp_global(3000);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
}

// ── Dispute Resolution Tests ────────────────────────────────────────────

/// Helper: bring a task to Disputed state, returns (escrow, token)
fn setup_disputed() -> (ITaskEscrowDispatcher, ContractAddress) {
    let (escrow, token) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.submit_proof(1, 'proof_hash');
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.dispute_task(1, 'dispute_reason');
    stop_cheat_caller_address(escrow.contract_address);

    (escrow, token)
}

#[test]
fn test_resolve_dispute_assignee_wins() {
    let (escrow, token) = setup_disputed();
    let mock = IMockERC20Dispatcher { contract_address: token };

    let bidder_before = mock.balance_of(BIDDER());

    // Owner resolves in favor of assignee
    start_cheat_caller_address(escrow.contract_address, OWNER());
    escrow.resolve_dispute(1, DisputeRuling::AssigneeWins);
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Settled, 'should be settled');

    let bidder_after = mock.balance_of(BIDDER());
    assert(bidder_after == bidder_before + 100, 'assignee should get full reward');
}

#[test]
fn test_resolve_dispute_poster_wins() {
    let (escrow, token) = setup_disputed();
    let mock = IMockERC20Dispatcher { contract_address: token };

    // Poster had 10000, spent 100 on post → 9900
    let poster_before = mock.balance_of(POSTER());

    start_cheat_caller_address(escrow.contract_address, OWNER());
    escrow.resolve_dispute(1, DisputeRuling::PosterWins);
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Settled, 'should be settled');

    let poster_after = mock.balance_of(POSTER());
    assert(poster_after == poster_before + 100, 'poster should get refund');
}

#[test]
fn test_resolve_dispute_split() {
    let (escrow, token) = setup_disputed();
    let mock = IMockERC20Dispatcher { contract_address: token };

    let poster_before = mock.balance_of(POSTER());
    let bidder_before = mock.balance_of(BIDDER());

    start_cheat_caller_address(escrow.contract_address, OWNER());
    escrow.resolve_dispute(1, DisputeRuling::Split);
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Settled, 'should be settled');

    // 100 / 2 = 50 each
    let poster_after = mock.balance_of(POSTER());
    let bidder_after = mock.balance_of(BIDDER());
    assert(bidder_after == bidder_before + 50, 'assignee gets half');
    assert(poster_after == poster_before + 50, 'poster gets half');
}

#[test]
#[should_panic(expected: 'Caller is not the owner')]
fn test_non_owner_cannot_resolve_dispute() {
    let (escrow, _) = setup_disputed();

    // Non-owner tries to resolve
    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.resolve_dispute(1, DisputeRuling::AssigneeWins);
}

#[test]
#[should_panic(expected: 'task not disputed')]
fn test_cannot_resolve_non_disputed_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    // Task is Open, not Disputed
    start_cheat_caller_address(escrow.contract_address, OWNER());
    escrow.resolve_dispute(1, DisputeRuling::PosterWins);
}

#[test]
fn test_force_settle_after_window() {
    let (escrow, token) = setup_disputed();
    let mock = IMockERC20Dispatcher { contract_address: token };

    let poster_before = mock.balance_of(POSTER());

    // Dispute window is 7 days = 604800 seconds
    // Dispute was filed at t=1000, window expires at t=605800
    let deadline = escrow.get_dispute_deadline(1);
    assert(deadline == 1000 + 604800, 'wrong dispute deadline');

    // Move time past the dispute window
    start_cheat_block_timestamp_global(deadline);

    // Either party can force settle — poster tries
    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.force_settle_dispute(1);
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Settled, 'should be settled');

    // Default: refund to poster
    let poster_after = mock.balance_of(POSTER());
    assert(poster_after == poster_before + 100, 'poster should get refund');
}

#[test]
fn test_assignee_can_also_force_settle() {
    let (escrow, token) = setup_disputed();
    let mock = IMockERC20Dispatcher { contract_address: token };

    let poster_before = mock.balance_of(POSTER());

    let deadline = escrow.get_dispute_deadline(1);
    start_cheat_block_timestamp_global(deadline);

    // Assignee forces the settle (still refunds poster by default)
    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.force_settle_dispute(1);
    stop_cheat_caller_address(escrow.contract_address);

    let task = escrow.get_task(1);
    assert(task.status == TaskStatus::Settled, 'should be settled');

    let poster_after = mock.balance_of(POSTER());
    assert(poster_after == poster_before + 100, 'poster refunded on force settle');
}

#[test]
#[should_panic(expected: 'dispute window not expired')]
fn test_cannot_force_settle_before_window() {
    let (escrow, _) = setup_disputed();

    // Still at t=1000, window expires at t=605800
    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.force_settle_dispute(1);
}

#[test]
#[should_panic(expected: 'only poster or assignee')]
fn test_random_cannot_force_settle() {
    let (escrow, _) = setup_disputed();

    let deadline = escrow.get_dispute_deadline(1);
    start_cheat_block_timestamp_global(deadline);

    // Random address tries to force settle
    start_cheat_caller_address(escrow.contract_address, BIDDER2());
    escrow.force_settle_dispute(1);
}

// ── Additional Edge Case Tests ────────────────────────────────────────────

#[test]
#[should_panic(expected: 'task not open')]
fn test_cannot_bid_assigned_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    // Try to bid on assigned task
    start_cheat_caller_address(escrow.contract_address, BIDDER2());
    escrow.bid_task(1, 60);
}

#[test]
#[should_panic(expected: 'reward must be > 0')]
fn test_cannot_post_zero_reward() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 0, 2000, 1);
}

#[test]
#[should_panic(expected: 'description hash required')]
fn test_cannot_post_empty_description() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task(0, 100, 2000, 1);
}

#[test]
#[should_panic(expected: 'only poster can approve')]
fn test_non_poster_cannot_approve() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.submit_proof(1, 'proof_hash');
    stop_cheat_caller_address(escrow.contract_address);

    // Non-poster tries to approve
    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.approve_task(1);
}

#[test]
#[should_panic(expected: 'task not submitted')]
fn test_cannot_approve_open_task() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    escrow.approve_task(1); // task is Open, not Submitted
}

#[test]
#[should_panic(expected: 'only poster can cancel')]
fn test_non_poster_cannot_cancel() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.cancel_task(1);
}

#[test]
#[should_panic(expected: 'proof hash required')]
fn test_cannot_submit_empty_proof() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.submit_proof(1, 0);
}

#[test]
#[should_panic(expected: 'bid must be > 0')]
fn test_cannot_bid_zero() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 0);
}

#[test]
#[should_panic(expected: 'only poster can dispute')]
fn test_non_poster_cannot_dispute() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.bid_task(1, 80);
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.accept_bid(1, BIDDER());
    stop_cheat_caller_address(escrow.contract_address);

    start_cheat_caller_address(escrow.contract_address, BIDDER());
    escrow.submit_proof(1, 'proof_hash');
    stop_cheat_caller_address(escrow.contract_address);

    // Non-poster tries to dispute
    start_cheat_caller_address(escrow.contract_address, BIDDER2());
    escrow.dispute_task(1, 'reason');
}

#[test]
fn test_dispute_deadline_zero_for_undisputed() {
    let (escrow, _) = setup();

    start_cheat_caller_address(escrow.contract_address, POSTER());
    escrow.post_task('task_desc_hash', 100, 2000, 1);
    stop_cheat_caller_address(escrow.contract_address);

    assert(escrow.get_dispute_deadline(1) == 0, 'should be 0 for undisputed');
}
