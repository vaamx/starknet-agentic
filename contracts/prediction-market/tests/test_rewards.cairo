use core::poseidon::poseidon_hash_span;
use prediction_market::interfaces::{
    IERC20Dispatcher, IERC20DispatcherTrait, IRewardDistributorDispatcher,
    IRewardDistributorDispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

fn owner() -> ContractAddress {
    0x999.try_into().unwrap()
}

fn alice() -> ContractAddress {
    0xA11CE.try_into().unwrap()
}

fn token_address() -> ContractAddress {
    let token_class = declare("MockERC20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    token_addr
}

fn deploy_distributor() -> (IRewardDistributorDispatcher, ContractAddress) {
    let distributor_class = declare("RewardDistributor").unwrap().contract_class();
    let (address, _) = distributor_class.deploy(@array![owner().into()]).unwrap();
    (IRewardDistributorDispatcher { contract_address: address }, address)
}

fn compute_leaf(epoch_id: u64, index: u64, account: ContractAddress, amount: u256) -> felt252 {
    poseidon_hash_span(
        array![
            epoch_id.into(),
            index.into(),
            account.into(),
            amount.low.into(),
            amount.high.into(),
        ]
            .span(),
    )
}

fn mint_to(token: ContractAddress, recipient: ContractAddress, amount: u256) {
    let _ = starknet::syscalls::call_contract_syscall(
        token,
        selector!("mint"),
        array![recipient.into(), amount.low.into(), amount.high.into()].span(),
    )
        .unwrap();
}

#[test]
fn test_publish_and_claim_single_leaf() {
    let (dist, dist_addr) = deploy_distributor();
    let token = token_address();
    let epoch_id: u64 = 1;
    let index: u64 = 0;
    let amount: u256 = 1000;
    let leaf = compute_leaf(epoch_id, index, alice(), amount);

    start_cheat_caller_address(dist_addr, owner());
    dist.publish_epoch(epoch_id, leaf, token, amount, 0x1234);
    stop_cheat_caller_address(dist_addr);

    mint_to(token, dist_addr, amount);

    start_cheat_caller_address(dist_addr, alice());
    dist.claim(epoch_id, index, alice(), amount, array![].span());
    stop_cheat_caller_address(dist_addr);

    assert(dist.is_claimed(epoch_id, index), 'must be claimed');

    let erc20 = IERC20Dispatcher { contract_address: token };
    assert_eq!(erc20.balance_of(alice()), amount);
}

#[test]
#[should_panic(expected: 'already claimed')]
fn test_double_claim_reverts() {
    let (dist, dist_addr) = deploy_distributor();
    let token = token_address();
    let epoch_id: u64 = 2;
    let amount: u256 = 500;
    let leaf = compute_leaf(epoch_id, 0, alice(), amount);

    start_cheat_caller_address(dist_addr, owner());
    dist.publish_epoch(epoch_id, leaf, token, amount, 0x99);
    stop_cheat_caller_address(dist_addr);

    mint_to(token, dist_addr, amount);

    start_cheat_caller_address(dist_addr, alice());
    dist.claim(epoch_id, 0, alice(), amount, array![].span());
    dist.claim(epoch_id, 0, alice(), amount, array![].span());
}

#[test]
#[should_panic(expected: 'invalid merkle proof')]
fn test_invalid_proof_reverts() {
    let (dist, dist_addr) = deploy_distributor();
    let token = token_address();
    let epoch_id: u64 = 3;
    let amount: u256 = 250;
    let wrong_leaf = compute_leaf(epoch_id, 0, owner(), amount);

    start_cheat_caller_address(dist_addr, owner());
    dist.publish_epoch(epoch_id, wrong_leaf, token, amount, 0x88);
    stop_cheat_caller_address(dist_addr);

    mint_to(token, dist_addr, amount);

    start_cheat_caller_address(dist_addr, alice());
    dist.claim(epoch_id, 0, alice(), amount, array![].span());
}

#[test]
#[should_panic(expected: 'caller must match account')]
fn test_claim_requires_caller_match() {
    let (dist, dist_addr) = deploy_distributor();
    let token = token_address();
    let epoch_id: u64 = 4;
    let amount: u256 = 100;
    let leaf = compute_leaf(epoch_id, 0, alice(), amount);

    start_cheat_caller_address(dist_addr, owner());
    dist.publish_epoch(epoch_id, leaf, token, amount, 0x77);
    stop_cheat_caller_address(dist_addr);

    mint_to(token, dist_addr, amount);

    start_cheat_caller_address(dist_addr, owner());
    dist.claim(epoch_id, 0, alice(), amount, array![].span());
}
