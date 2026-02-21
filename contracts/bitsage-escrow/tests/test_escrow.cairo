use starknet::{ContractAddress, contract_address_const};
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
    spy_events, EventSpyAssertionsTrait,
};
use bitsage_escrow::bitsage_escrow::{
    IBitsageEscrowDispatcher, IBitsageEscrowDispatcherTrait,
    BitsageEscrow::Event, BitsageEscrow::Deposited, BitsageEscrow::Deducted,
    BitsageEscrow::Withdrawn,
};
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn OWNER() -> ContractAddress { contract_address_const::<0xAA>() }
fn OPERATOR() -> ContractAddress { contract_address_const::<0xBB>() }
fn AGENT() -> ContractAddress { contract_address_const::<0xCC>() }
fn OTHER() -> ContractAddress { contract_address_const::<0xDD>() }

/// Deploy a minimal mock ERC-20 with a pre-funded minter address.
fn deploy_mock_strk(mint_to: ContractAddress, amount: u256) -> ContractAddress {
    // Use OZ ERC-20 mock from snforge_std
    let erc20_class = declare("ERC20Upgradeable").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    // OZ ERC20 constructor: name, symbol, supply, recipient, owner
    calldata.append('MockSTRK');
    calldata.append('MSTRK');
    calldata.append(amount.low.into());
    calldata.append(amount.high.into());
    calldata.append(mint_to.into());
    calldata.append(mint_to.into());
    let (strk_addr, _) = erc20_class.deploy(@calldata).unwrap();
    strk_addr
}

/// Deploy the escrow contract.
fn deploy_escrow(strk_addr: ContractAddress) -> IBitsageEscrowDispatcher {
    let escrow_class = declare("BitsageEscrow").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(OWNER().into());
    calldata.append(OPERATOR().into());
    calldata.append(strk_addr.into());
    let (escrow_addr, _) = escrow_class.deploy(@calldata).unwrap();
    IBitsageEscrowDispatcher { contract_address: escrow_addr }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_deposit() {
    let amount: u256 = 100_u256 * 1_000_000_000_000_000_000_u256; // 100 STRK
    let strk_addr = deploy_mock_strk(AGENT(), amount);
    let escrow = deploy_escrow(strk_addr);
    let strk = IERC20Dispatcher { contract_address: strk_addr };

    // Approve escrow to spend AGENT's tokens
    start_cheat_caller_address(strk_addr, AGENT());
    strk.approve(escrow.contract_address, amount);
    stop_cheat_caller_address(strk_addr);

    // Deposit
    start_cheat_caller_address(escrow.contract_address, AGENT());
    escrow.deposit(amount);
    stop_cheat_caller_address(escrow.contract_address);

    assert(escrow.balance_of(AGENT()) == amount, 'Balance should equal deposit');
}

#[test]
fn test_deduct_authorized() {
    let deposit_amount: u256 = 100_u256 * 1_000_000_000_000_000_000_u256;
    let deduct_amount: u256 = 10_u256 * 1_000_000_000_000_000_000_u256;
    let strk_addr = deploy_mock_strk(AGENT(), deposit_amount);
    let escrow = deploy_escrow(strk_addr);
    let strk = IERC20Dispatcher { contract_address: strk_addr };

    start_cheat_caller_address(strk_addr, AGENT());
    strk.approve(escrow.contract_address, deposit_amount);
    stop_cheat_caller_address(strk_addr);

    start_cheat_caller_address(escrow.contract_address, AGENT());
    escrow.deposit(deposit_amount);
    stop_cheat_caller_address(escrow.contract_address);

    // Operator deducts
    start_cheat_caller_address(escrow.contract_address, OPERATOR());
    escrow.deduct(AGENT(), deduct_amount);
    stop_cheat_caller_address(escrow.contract_address);

    assert(
        escrow.balance_of(AGENT()) == deposit_amount - deduct_amount,
        'Balance should decrease after deduct'
    );
}

#[test]
#[should_panic(expected: 'Caller is not operator')]
fn test_deduct_unauthorized() {
    let amount: u256 = 100_u256 * 1_000_000_000_000_000_000_u256;
    let strk_addr = deploy_mock_strk(AGENT(), amount);
    let escrow = deploy_escrow(strk_addr);
    let strk = IERC20Dispatcher { contract_address: strk_addr };

    start_cheat_caller_address(strk_addr, AGENT());
    strk.approve(escrow.contract_address, amount);
    stop_cheat_caller_address(strk_addr);

    start_cheat_caller_address(escrow.contract_address, AGENT());
    escrow.deposit(amount);
    stop_cheat_caller_address(escrow.contract_address);

    // Non-operator attempts deduct — should panic
    start_cheat_caller_address(escrow.contract_address, OTHER());
    escrow.deduct(AGENT(), amount);
    stop_cheat_caller_address(escrow.contract_address);
}

#[test]
#[should_panic(expected: 'Insufficient balance')]
fn test_insufficient_balance_deduct() {
    let amount: u256 = 10_u256 * 1_000_000_000_000_000_000_u256;
    let strk_addr = deploy_mock_strk(AGENT(), amount);
    let escrow = deploy_escrow(strk_addr);
    let strk = IERC20Dispatcher { contract_address: strk_addr };

    start_cheat_caller_address(strk_addr, AGENT());
    strk.approve(escrow.contract_address, amount);
    stop_cheat_caller_address(strk_addr);

    start_cheat_caller_address(escrow.contract_address, AGENT());
    escrow.deposit(amount);
    stop_cheat_caller_address(escrow.contract_address);

    // Deduct more than deposited — should panic
    start_cheat_caller_address(escrow.contract_address, OPERATOR());
    escrow.deduct(AGENT(), amount + 1_u256);
    stop_cheat_caller_address(escrow.contract_address);
}

#[test]
fn test_withdraw() {
    let amount: u256 = 50_u256 * 1_000_000_000_000_000_000_u256;
    let strk_addr = deploy_mock_strk(AGENT(), amount);
    let escrow = deploy_escrow(strk_addr);
    let strk = IERC20Dispatcher { contract_address: strk_addr };

    start_cheat_caller_address(strk_addr, AGENT());
    strk.approve(escrow.contract_address, amount);
    stop_cheat_caller_address(strk_addr);

    start_cheat_caller_address(escrow.contract_address, AGENT());
    escrow.deposit(amount);

    // Withdraw half
    let withdraw_amount: u256 = amount / 2_u256;
    escrow.withdraw(withdraw_amount);
    stop_cheat_caller_address(escrow.contract_address);

    assert(escrow.balance_of(AGENT()) == amount - withdraw_amount, 'Balance should be halved');
    // Tokens returned to agent
    assert(strk.balance_of(AGENT()) == withdraw_amount, 'Agent should have tokens back');
}
