use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
use crate::interfaces::{
    IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IAgentTokenDispatcher,
    IAgentTokenDispatcherTrait, CurveType,
};

fn OWNER() -> ContractAddress {
    0xAA.try_into().unwrap()
}

fn BUYER() -> ContractAddress {
    0xBB.try_into().unwrap()
}

fn BUYER2() -> ContractAddress {
    0xCC.try_into().unwrap()
}

#[starknet::interface]
trait IMockERC20<TState> {
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
}

fn deploy_mock_token() -> ContractAddress {
    // We need a mock ERC20 — reuse from task-escrow or inline
    // For now, use the AgentToken itself as a simple ERC20 for reserve
    let contract = declare("AgentToken").unwrap().contract_class();
    let mut calldata = array![];
    let name: ByteArray = "Reserve";
    let symbol: ByteArray = "RSV";
    name.serialize(ref calldata);
    symbol.serialize(ref calldata);
    OWNER().serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    addr
}

fn deploy_agent_token() -> ContractAddress {
    let contract = declare("AgentToken").unwrap().contract_class();
    let mut calldata = array![];
    let name: ByteArray = "TestToken";
    let symbol: ByteArray = "TT";
    name.serialize(ref calldata);
    symbol.serialize(ref calldata);
    OWNER().serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    addr
}

fn deploy_curve(
    token: ContractAddress, reserve_token: ContractAddress, curve_type: u8, fee_bps: u16,
) -> IBondingCurveDispatcher {
    let contract = declare("BondingCurve").unwrap().contract_class();
    let mut calldata = array![];
    token.serialize(ref calldata);
    reserve_token.serialize(ref calldata);
    curve_type.serialize(ref calldata);
    fee_bps.serialize(ref calldata);
    OWNER().serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    IBondingCurveDispatcher { contract_address: addr }
}

fn setup_linear() -> (IBondingCurveDispatcher, ContractAddress, ContractAddress) {
    let reserve_token = deploy_mock_token();
    let agent_token = deploy_agent_token();
    let curve = deploy_curve(agent_token, reserve_token, 0, 100); // 1% fee, linear

    // Set curve on agent token
    start_cheat_caller_address(agent_token, OWNER());
    IAgentTokenDispatcher { contract_address: agent_token }.set_curve(curve.contract_address);
    stop_cheat_caller_address(agent_token);

    // Mint reserve tokens to buyer and approve curve
    start_cheat_caller_address(reserve_token, OWNER());
    IAgentTokenDispatcher { contract_address: reserve_token }.mint(BUYER(), 1_000_000_000_000_000_000_000); // 1000 tokens
    IAgentTokenDispatcher { contract_address: reserve_token }.mint(BUYER2(), 1_000_000_000_000_000_000_000);
    stop_cheat_caller_address(reserve_token);

    // Approve curve to spend reserve tokens (AgentToken embeds ERC20Component which exposes approve)
    start_cheat_caller_address(reserve_token, BUYER());
    IMockERC20Dispatcher { contract_address: reserve_token }.approve(curve.contract_address, 1_000_000_000_000_000_000_000);
    stop_cheat_caller_address(reserve_token);

    start_cheat_caller_address(reserve_token, BUYER2());
    IMockERC20Dispatcher { contract_address: reserve_token }.approve(curve.contract_address, 1_000_000_000_000_000_000_000);
    stop_cheat_caller_address(reserve_token);

    (curve, agent_token, reserve_token)
}

#[test]
fn test_initial_state() {
    let (curve, _, _) = setup_linear();
    assert(curve.get_current_supply() == 0, 'initial supply should be 0');
    assert(curve.get_reserve_balance() == 0, 'initial reserve should be 0');
    assert(curve.get_fee_bps() == 100, 'fee should be 100 bps');
}

#[test]
fn test_get_buy_price_increases() {
    let (curve, _, _) = setup_linear();

    let price_at_zero = curve.get_buy_price(1_000_000_000_000_000_000); // 1 token
    let price_at_ten = curve.get_buy_price(10_000_000_000_000_000_000); // 10 tokens

    // Price for 10 tokens should be more than 10x price for 1 token (due to slope)
    assert(price_at_ten > price_at_zero * 10, 'price should increase');
}

#[test]
fn test_curve_type() {
    let (curve, _, _) = setup_linear();
    let ct = curve.get_curve_type();
    assert(ct == CurveType::Linear, 'should be linear');
}

#[test]
fn test_quadratic_curve_deploy() {
    let reserve_token = deploy_mock_token();
    let agent_token = deploy_agent_token();
    let curve = deploy_curve(agent_token, reserve_token, 1, 200); // quadratic, 2% fee

    assert(curve.get_curve_type() == CurveType::Quadratic, 'should be quadratic');
    assert(curve.get_fee_bps() == 200, 'fee should be 200 bps');
}

#[test]
fn test_sell_price_zero_supply() {
    let (curve, _, _) = setup_linear();
    let sell_price = curve.get_sell_price(1_000_000_000_000_000_000);
    assert(sell_price == 0, 'sell price at 0 supply should be 0');
}

// -----------------------------------------------------------------------
// Buy / sell integration tests
// -----------------------------------------------------------------------

fn setup_quadratic() -> (IBondingCurveDispatcher, ContractAddress, ContractAddress) {
    let reserve_token = deploy_mock_token();
    let agent_token = deploy_agent_token();
    let curve = deploy_curve(agent_token, reserve_token, 1, 100); // quadratic, 1% fee

    start_cheat_caller_address(agent_token, OWNER());
    IAgentTokenDispatcher { contract_address: agent_token }.set_curve(curve.contract_address);
    stop_cheat_caller_address(agent_token);

    start_cheat_caller_address(reserve_token, OWNER());
    IAgentTokenDispatcher { contract_address: reserve_token }.mint(BUYER(), 1_000_000_000_000_000_000_000);
    IAgentTokenDispatcher { contract_address: reserve_token }.mint(BUYER2(), 1_000_000_000_000_000_000_000);
    stop_cheat_caller_address(reserve_token);

    start_cheat_caller_address(reserve_token, BUYER());
    IMockERC20Dispatcher { contract_address: reserve_token }.approve(curve.contract_address, 1_000_000_000_000_000_000_000);
    stop_cheat_caller_address(reserve_token);

    start_cheat_caller_address(reserve_token, BUYER2());
    IMockERC20Dispatcher { contract_address: reserve_token }.approve(curve.contract_address, 1_000_000_000_000_000_000_000);
    stop_cheat_caller_address(reserve_token);

    (curve, agent_token, reserve_token)
}

#[test]
fn test_buy_tokens() {
    let (curve, agent_token, reserve_token) = setup_linear();
    let buy_amount = 10_000_000_000_000_000_000; // 10 tokens (1e19)

    let supply_before = curve.get_current_supply();
    let buyer_reserve_before = IMockERC20Dispatcher { contract_address: reserve_token }.balance_of(BUYER());

    start_cheat_caller_address(curve.contract_address, BUYER());
    let cost = curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    // Supply increased
    let supply_after = curve.get_current_supply();
    assert(supply_after == supply_before + buy_amount, 'supply should increase');

    // Buyer received agent tokens
    let buyer_agent_balance = IMockERC20Dispatcher { contract_address: agent_token }.balance_of(BUYER());
    assert(buyer_agent_balance == buy_amount, 'buyer should have agent tokens');

    // Buyer spent reserve tokens
    let buyer_reserve_after = IMockERC20Dispatcher { contract_address: reserve_token }.balance_of(BUYER());
    assert(buyer_reserve_after == buyer_reserve_before - cost, 'reserve should decrease by cost');

    // Reserve balance in curve increased
    assert(curve.get_reserve_balance() == cost, 'curve reserve should match cost');
}

#[test]
fn test_sell_tokens() {
    let (curve, agent_token, reserve_token) = setup_linear();
    let buy_amount = 10_000_000_000_000_000_000; // 10 tokens

    // Buy first
    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    let supply_after_buy = curve.get_current_supply();
    let reserve_after_buy = curve.get_reserve_balance();
    let buyer_reserve_before_sell = IMockERC20Dispatcher { contract_address: reserve_token }.balance_of(BUYER());

    // Approve the curve to burn agent tokens (burn is called by curve, but for sell the caller
    // just needs to call sell — curve calls agent_token.burn internally, and curve is authorized)
    start_cheat_caller_address(curve.contract_address, BUYER());
    let proceeds = curve.sell(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    // Supply decreased
    assert(curve.get_current_supply() == supply_after_buy - buy_amount, 'supply should decrease');
    assert(curve.get_current_supply() == 0, 'supply should be 0');

    // Buyer received reserve tokens back
    let buyer_reserve_after_sell = IMockERC20Dispatcher { contract_address: reserve_token }.balance_of(BUYER());
    assert(buyer_reserve_after_sell == buyer_reserve_before_sell + proceeds, 'should receive proceeds');

    // Proceeds should be less than cost due to fee on sell
    assert(proceeds > 0, 'proceeds should be positive');

    // Agent token balance should be 0
    let buyer_agent_balance = IMockERC20Dispatcher { contract_address: agent_token }.balance_of(BUYER());
    assert(buyer_agent_balance == 0, 'agent balance should be 0');
}

#[test]
fn test_fee_collection() {
    let (curve, _, _) = setup_linear();
    let buy_amount = 10_000_000_000_000_000_000; // 10 tokens

    // Get the raw cost (what get_buy_price returns, which is without fee adjustment)
    let quoted_price = curve.get_buy_price(buy_amount);

    start_cheat_caller_address(curve.contract_address, BUYER());
    let actual_cost = curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    // The actual cost paid by buyer equals the raw cost (buyer pays full cost including fee portion).
    // The fee is embedded in the cost — the curve keeps the fee as part of the reserve.
    assert(actual_cost == quoted_price, 'cost should match quoted price');
    assert(actual_cost > 0, 'cost should be positive');

    // After selling, proceeds are less than cost because sell applies fee deduction
    let sell_quote = curve.get_sell_price(buy_amount);
    assert(sell_quote < actual_cost, 'sell should be less than buy');
}

#[test]
#[should_panic(expected: 'insufficient supply')]
fn test_cannot_sell_more_than_supply() {
    let (curve, _, _) = setup_linear();

    // Supply is 0, try to sell 1 token
    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.sell(1_000_000_000_000_000_000);
}

// -----------------------------------------------------------------------
// withdraw_fees tests
// -----------------------------------------------------------------------

fn RECIPIENT() -> ContractAddress {
    0xEE.try_into().unwrap()
}

#[test]
fn test_withdraw_fees_after_buy_sell() {
    let (curve, agent_token, reserve_token) = setup_linear();
    let mock = IMockERC20Dispatcher { contract_address: reserve_token };
    let buy_amount = 10_000_000_000_000_000_000; // 10 tokens

    // Buy
    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    let fees_after_buy = curve.get_fees_collected();
    assert(fees_after_buy > 0, 'buy should generate fees');

    // Sell all
    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.sell(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    let total_fees = curve.get_fees_collected();
    assert(total_fees > fees_after_buy, 'sell should add more fees');

    // Withdraw fees
    let recipient_before = mock.balance_of(RECIPIENT());
    start_cheat_caller_address(curve.contract_address, OWNER());
    let withdrawn = curve.withdraw_fees(RECIPIENT());
    stop_cheat_caller_address(curve.contract_address);

    assert(withdrawn == total_fees, 'should withdraw all fees');
    assert(curve.get_fees_collected() == 0, 'fees should be zero after');

    let recipient_after = mock.balance_of(RECIPIENT());
    assert(recipient_after == recipient_before + total_fees, 'recipient should receive fees');
}

#[test]
#[should_panic(expected: 'only owner')]
fn test_non_owner_cannot_withdraw_fees() {
    let (curve, _, _) = setup_linear();
    let buy_amount = 10_000_000_000_000_000_000;

    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    // Non-owner tries to withdraw
    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.withdraw_fees(BUYER());
}

#[test]
#[should_panic(expected: 'no fees to withdraw')]
fn test_cannot_withdraw_zero_fees() {
    let (curve, _, _) = setup_linear();

    start_cheat_caller_address(curve.contract_address, OWNER());
    curve.withdraw_fees(OWNER());
}

#[test]
fn test_reserve_invariant_after_withdraw() {
    // Verifies that after withdrawing fees, remaining sellers can still be paid
    let (curve, _, reserve_token) = setup_linear();
    let mock = IMockERC20Dispatcher { contract_address: reserve_token };
    let buy_amount = 10_000_000_000_000_000_000; // 10 tokens

    // BUYER buys
    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    // BUYER2 buys
    start_cheat_caller_address(curve.contract_address, BUYER2());
    curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    // Owner withdraws accumulated buy fees
    start_cheat_caller_address(curve.contract_address, OWNER());
    curve.withdraw_fees(OWNER());
    stop_cheat_caller_address(curve.contract_address);

    // Contract token balance should equal reserve_balance (fees are gone)
    let contract_balance = mock.balance_of(curve.contract_address);
    let reserve = curve.get_reserve_balance();
    assert(contract_balance == reserve, 'balance should match reserve');

    // BUYER2 sells — should succeed (reserve covers it)
    start_cheat_caller_address(curve.contract_address, BUYER2());
    let proceeds = curve.sell(buy_amount);
    stop_cheat_caller_address(curve.contract_address);
    assert(proceeds > 0, 'seller should receive proceeds');

    // BUYER sells — should also succeed
    start_cheat_caller_address(curve.contract_address, BUYER());
    let proceeds2 = curve.sell(buy_amount);
    stop_cheat_caller_address(curve.contract_address);
    assert(proceeds2 > 0, 'first seller should receive');

    // Supply should be 0
    assert(curve.get_current_supply() == 0, 'supply should be 0');
}

#[test]
fn test_fees_collected_equals_contract_surplus() {
    // After buy: contract holds reserve_balance + fees_collected worth of tokens
    let (curve, _, reserve_token) = setup_linear();
    let mock = IMockERC20Dispatcher { contract_address: reserve_token };
    let buy_amount = 10_000_000_000_000_000_000;

    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    let contract_balance = mock.balance_of(curve.contract_address);
    let reserve = curve.get_reserve_balance();
    let fees = curve.get_fees_collected();

    assert(contract_balance == reserve + fees, 'balance = reserve + fees');
}

#[test]
fn test_sell_fee_doesnt_inflate_reserve() {
    // After buy+sell, reserve_balance + fees_collected should still equal contract balance
    let (curve, _, reserve_token) = setup_linear();
    let mock = IMockERC20Dispatcher { contract_address: reserve_token };
    let buy_amount = 10_000_000_000_000_000_000;

    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.buy(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    start_cheat_caller_address(curve.contract_address, BUYER());
    curve.sell(buy_amount);
    stop_cheat_caller_address(curve.contract_address);

    let contract_balance = mock.balance_of(curve.contract_address);
    let reserve = curve.get_reserve_balance();
    let fees = curve.get_fees_collected();

    assert(contract_balance == reserve + fees, 'invariant: balance = reserve + fees after sell');
}

#[test]
fn test_quadratic_price_grows_faster() {
    let (linear_curve, _, _) = setup_linear();
    let (quad_curve, _, _) = setup_quadratic();

    // Compare prices at a larger supply offset by buying some tokens first on both curves
    // At supply=0, get price for 100 tokens
    let small_amount = 1_000_000_000_000_000_000; // 1 token
    let large_amount = 100_000_000_000_000_000_000; // 100 tokens

    let linear_price_small = linear_curve.get_buy_price(small_amount);
    let linear_price_large = linear_curve.get_buy_price(large_amount);

    let quad_price_small = quad_curve.get_buy_price(small_amount);
    let quad_price_large = quad_curve.get_buy_price(large_amount);

    // Quadratic should have a higher ratio of large/small price than linear
    // i.e., quadratic grows faster relative to its own starting price
    // linear: ratio ~ 100x + some slope contribution
    // quadratic: ratio ~ 100^3 / 1 at supply 0 = much steeper
    // We check that the quadratic large price relative to small is bigger than the linear ratio
    // To avoid division, check: quad_large * linear_small > linear_large * quad_small
    assert(
        quad_price_large * linear_price_small > linear_price_large * quad_price_small,
        'quadratic should grow faster',
    );
}
