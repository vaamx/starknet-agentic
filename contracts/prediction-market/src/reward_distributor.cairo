#[starknet::contract]
pub mod RewardDistributor {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::merkle_tree::merkle_proof::verify_poseidon;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::*;
    use prediction_market::interfaces::{IERC20Dispatcher, IERC20DispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        epoch_published: Map<u64, bool>,
        epoch_root: Map<u64, felt252>,
        epoch_token: Map<u64, ContractAddress>,
        epoch_total: Map<u64, u256>,
        epoch_claimed_total: Map<u64, u256>,
        epoch_metadata_hash: Map<u64, felt252>,
        claimed: Map<(u64, u64), bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        EpochPublished: EpochPublished,
        Claimed: Claimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EpochPublished {
        #[key]
        pub epoch_id: u64,
        pub merkle_root: felt252,
        pub token: ContractAddress,
        pub total_amount: u256,
        pub metadata_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub epoch_id: u64,
        #[key]
        pub index: u64,
        #[key]
        pub account: ContractAddress,
        pub amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        assert(!owner.is_zero(), 'invalid owner');
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl RewardDistributorImpl of prediction_market::interfaces::IRewardDistributor<ContractState> {
        fn publish_epoch(
            ref self: ContractState,
            epoch_id: u64,
            merkle_root: felt252,
            token: ContractAddress,
            total_amount: u256,
            metadata_hash: felt252,
        ) {
            self.ownable.assert_only_owner();
            assert(!self.epoch_published.entry(epoch_id).read(), 'epoch already published');
            assert(!token.is_zero(), 'invalid token');
            assert(total_amount > 0, 'total amount must be positive');

            self.epoch_published.entry(epoch_id).write(true);
            self.epoch_root.entry(epoch_id).write(merkle_root);
            self.epoch_token.entry(epoch_id).write(token);
            self.epoch_total.entry(epoch_id).write(total_amount);
            self.epoch_claimed_total.entry(epoch_id).write(0);
            self.epoch_metadata_hash.entry(epoch_id).write(metadata_hash);

            self.emit(EpochPublished {
                epoch_id,
                merkle_root,
                token,
                total_amount,
                metadata_hash,
            });
        }

        fn claim(
            ref self: ContractState,
            epoch_id: u64,
            index: u64,
            account: ContractAddress,
            amount: u256,
            proof: Span<felt252>,
        ) {
            assert(self.epoch_published.entry(epoch_id).read(), 'epoch not published');
            assert(!self.claimed.entry((epoch_id, index)).read(), 'already claimed');
            assert(amount > 0, 'amount must be positive');
            assert(get_caller_address() == account, 'caller must match account');

            let root = self.epoch_root.entry(epoch_id).read();
            let leaf = compute_leaf(epoch_id, index, account, amount);
            assert(verify_poseidon(proof, root, leaf), 'invalid merkle proof');

            let prev_claimed = self.epoch_claimed_total.entry(epoch_id).read();
            let next_claimed = prev_claimed + amount;
            assert(
                next_claimed <= self.epoch_total.entry(epoch_id).read(),
                'epoch exhausted',
            );

            self.claimed.entry((epoch_id, index)).write(true);
            self.epoch_claimed_total.entry(epoch_id).write(next_claimed);

            let token = IERC20Dispatcher { contract_address: self.epoch_token.entry(epoch_id).read() };
            let success = token.transfer(account, amount);
            assert(success, 'reward transfer failed');

            self.emit(Claimed { epoch_id, index, account, amount });
        }

        fn is_claimed(self: @ContractState, epoch_id: u64, index: u64) -> bool {
            self.claimed.entry((epoch_id, index)).read()
        }

        fn get_epoch(
            self: @ContractState, epoch_id: u64,
        ) -> (bool, felt252, ContractAddress, u256, u256, felt252) {
            (
                self.epoch_published.entry(epoch_id).read(),
                self.epoch_root.entry(epoch_id).read(),
                self.epoch_token.entry(epoch_id).read(),
                self.epoch_total.entry(epoch_id).read(),
                self.epoch_claimed_total.entry(epoch_id).read(),
                self.epoch_metadata_hash.entry(epoch_id).read(),
            )
        }
    }

    fn compute_leaf(
        epoch_id: u64, index: u64, account: ContractAddress, amount: u256,
    ) -> felt252 {
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
}
