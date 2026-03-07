#[starknet::contract]
pub mod AgentToken {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use openzeppelin::token::erc20::ERC20Component;
    use openzeppelin::token::erc20::ERC20HooksEmptyImpl;
    use crate::interfaces::IAgentToken;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    #[abi(embed_v0)]
    impl ERC20Impl = ERC20Component::ERC20Impl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        curve: ContractAddress,
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        owner: ContractAddress,
    ) {
        self.erc20.initializer(name, symbol);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl AgentTokenImpl of IAgentToken<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            let caller = starknet::get_caller_address();
            let curve = self.curve.read();
            assert(caller == curve || caller == self.owner.read(), 'only curve or owner can mint');
            self.erc20.mint(to, amount);
        }

        fn burn(ref self: ContractState, from: ContractAddress, amount: u256) {
            let caller = starknet::get_caller_address();
            let curve = self.curve.read();
            assert(caller == curve || caller == self.owner.read(), 'only curve or owner can burn');
            self.erc20.burn(from, amount);
        }

        fn set_curve(ref self: ContractState, curve: ContractAddress) {
            let caller = starknet::get_caller_address();
            assert(caller == self.owner.read(), 'only owner can set curve');
            self.curve.write(curve);
        }
    }
}
