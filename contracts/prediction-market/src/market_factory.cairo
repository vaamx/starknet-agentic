#[starknet::contract]
pub mod MarketFactory {
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::storage::*;
    use starknet::{
        ClassHash, ContractAddress, get_caller_address, syscalls::deploy_syscall,
        get_block_timestamp,
    };
    use core::poseidon::poseidon_hash_span;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        market_class_hash: ClassHash,
        fee_recipient: ContractAddress,
        market_count: u256,
        markets: Map<u256, ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        MarketCreated: MarketCreated,
        FeeRecipientUpdated: FeeRecipientUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketCreated {
        #[key]
        pub market_id: u256,
        pub market_address: ContractAddress,
        pub creator: ContractAddress,
        pub question_hash: felt252,
        pub resolution_time: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeRecipientUpdated {
        pub previous_fee_recipient: ContractAddress,
        pub new_fee_recipient: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, owner: ContractAddress, market_class_hash: ClassHash,
    ) {
        self.ownable.initializer(owner);
        self.market_class_hash.write(market_class_hash);
        self.fee_recipient.write(owner);
        self.market_count.write(0);
    }

    #[abi(embed_v0)]
    impl MarketFactoryImpl of prediction_market::interfaces::IMarketFactory<ContractState> {
        fn create_market(
            ref self: ContractState,
            question_hash: felt252,
            resolution_time: u64,
            oracle: ContractAddress,
            collateral_token: ContractAddress,
            fee_bps: u16,
        ) -> (ContractAddress, u256) {
            let caller = get_caller_address();

            // Build constructor calldata
            let mut calldata: Array<felt252> = array![];
            calldata.append(question_hash);
            calldata.append(resolution_time.into());
            calldata.append(oracle.into());
            calldata.append(caller.into()); // creator = caller
            calldata.append(collateral_token.into());
            calldata.append(self.fee_recipient.read().into());
            calldata.append(fee_bps.into());

            // Unique salt from market count + caller + timestamp
            let market_id = self.market_count.read();
            let salt = poseidon_hash_span(
                array![market_id.low.into(), caller.into(), get_block_timestamp().into()].span(),
            );

            // Deploy
            let (market_address, _) = deploy_syscall(
                self.market_class_hash.read(), salt, calldata.span(), false,
            )
                .expect('deploy failed');

            // Register
            self.markets.entry(market_id).write(market_address);
            self.market_count.write(market_id + 1);

            self.emit(MarketCreated {
                market_id, market_address, creator: caller, question_hash, resolution_time,
            });

            (market_address, market_id)
        }

        fn get_market(self: @ContractState, id: u256) -> ContractAddress {
            self.markets.entry(id).read()
        }

        fn get_market_count(self: @ContractState) -> u256 {
            self.market_count.read()
        }

        fn set_fee_recipient(ref self: ContractState, fee_recipient: ContractAddress) {
            self.ownable.assert_only_owner();
            assert(!fee_recipient.is_zero(), 'bad fee recipient');
            let previous = self.fee_recipient.read();
            self.fee_recipient.write(fee_recipient);
            self.emit(FeeRecipientUpdated {
                previous_fee_recipient: previous,
                new_fee_recipient: fee_recipient,
            });
        }

        fn get_fee_recipient(self: @ContractState) -> ContractAddress {
            self.fee_recipient.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn update_market_class_hash(ref self: ContractState, new_class_hash: ClassHash) {
            self.ownable.assert_only_owner();
            self.market_class_hash.write(new_class_hash);
        }
    }
}
