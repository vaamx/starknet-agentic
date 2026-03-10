#[starknet::contract]
pub mod BuzzToken {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use openzeppelin::token::erc20::ERC20Component;
    use openzeppelin::token::erc20::ERC20HooksEmptyImpl;
    use crate::interfaces::IBuzzToken;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    #[abi(embed_v0)]
    impl ERC20Impl = ERC20Component::ERC20Impl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    // 1 billion tokens with 18 decimals
    const MAX_SUPPLY: u256 = 1_000_000_000_000_000_000_000_000_000;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        owner: ContractAddress,
        minters: Map<ContractAddress, bool>,
        total_minted: u256,
        max_supply: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        MinterAdded: MinterAdded,
        MinterRemoved: MinterRemoved,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MinterAdded {
        pub minter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MinterRemoved {
        pub minter: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.erc20.initializer("Buzz Token", "BUZZ");
        self.owner.write(owner);
        self.max_supply.write(MAX_SUPPLY);
        self.total_minted.write(0);
    }

    #[abi(embed_v0)]
    impl BuzzTokenImpl of IBuzzToken<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            let caller = starknet::get_caller_address();
            let is_owner = caller == self.owner.read();
            let is_minter = self.minters.entry(caller).read();
            assert(is_owner || is_minter, 'only owner or minter can mint');

            let new_total = self.total_minted.read() + amount;
            assert(new_total <= self.max_supply.read(), 'exceeds max supply');

            self.total_minted.write(new_total);
            self.erc20.mint(to, amount);
        }

        fn burn(ref self: ContractState, amount: u256) {
            let caller = starknet::get_caller_address();
            self.erc20.burn(caller, amount);
        }

        fn add_minter(ref self: ContractState, minter: ContractAddress) {
            let caller = starknet::get_caller_address();
            assert(caller == self.owner.read(), 'only owner');
            self.minters.entry(minter).write(true);
            self.emit(MinterAdded { minter });
        }

        fn remove_minter(ref self: ContractState, minter: ContractAddress) {
            let caller = starknet::get_caller_address();
            assert(caller == self.owner.read(), 'only owner');
            self.minters.entry(minter).write(false);
            self.emit(MinterRemoved { minter });
        }

        fn get_total_minted(self: @ContractState) -> u256 {
            self.total_minted.read()
        }

        fn get_max_supply(self: @ContractState) -> u256 {
            self.max_supply.read()
        }

        fn is_minter(self: @ContractState, address: ContractAddress) -> bool {
            self.minters.entry(address).read()
        }
    }
}
